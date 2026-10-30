import { useState, useEffect } from "react";
import { HelpCircle, Check, X, RotateCcw, Sparkles, BookOpen } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import type { PracticeQuizPayload } from "../state/types";

export interface PracticeQuizModalProps {
  assessmentId?: string;
}

export function PracticeQuizModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as PracticeQuizModalProps;
  const assessmentId = modalProps.assessmentId || "";

  const practiceGenerate = useAppStore((s) => s.practiceGenerate);
  const assessments = useAppStore((s) => s.data.assessments);
  const matchedAssessment = assessments.find((a) => a.id === assessmentId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<PracticeQuizPayload | null>(null);

  // User selections: map questionId -> selectedIndex
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    async function loadQuiz() {
      if (!assessmentId) {
        setError("No assessment selected");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const payload = await practiceGenerate(assessmentId);
        if (!cancelled) {
          setQuiz(payload);
          setSelectedAnswers({});
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    loadQuiz();
    return () => {
      cancelled = true;
    };
  }, [assessmentId, practiceGenerate]);

  const questions = quiz?.questions || [];
  const totalQuestions = questions.length;

  const handleSelectOption = (questionId: string, optionIndex: number) => {
    // Only allow selecting once per question
    if (selectedAnswers[questionId] !== undefined) return;
    setSelectedAnswers((prev) => ({
      ...prev,
      [questionId]: optionIndex,
    }));
  };

  const handleRestart = () => {
    setSelectedAnswers({});
  };

  // Calculate score
  let score = 0;
  questions.forEach((q) => {
    const userChoice = selectedAnswers[q.id];
    const correct = q.correctIndex ?? q.correct_index ?? 0;
    if (userChoice !== undefined && userChoice === correct) {
      score += 1;
    }
  });

  const isLocalFallback =
    quiz?.authoredLocally ||
    quiz?.authored_locally ||
    (!quiz?.generatedByAi && !quiz?.generated_by_ai);

  return (
    <div className="relative w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all max-h-[90vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
              <HelpCircle className="h-5 w-5" />
            </div>
            <h2 id="practice-quiz-title" className="text-xl font-bold text-[var(--text)]">
              {copy.practice.title}
            </h2>
          </div>
          {matchedAssessment && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {matchedAssessment.courseId ? `[${matchedAssessment.courseId}] ` : ""}
              {matchedAssessment.title}
            </p>
          )}
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

      {/* Provenance Badge */}
      {quiz && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--page)] p-3">
          <div className="flex items-center gap-2.5">
            {isLocalFallback ? (
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <BookOpen className="h-4 w-4" />
              </div>
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <Sparkles className="h-4 w-4" />
              </div>
            )}
            <div>
              <span
                data-testid="quiz-provenance-label"
                className="text-xs font-semibold text-[var(--text)]"
              >
                {isLocalFallback
                  ? copy.practice.localFallbackProvenance
                  : copy.practice.aiProvenance}
              </span>
              <p className="text-[11px] text-[var(--text-muted)]">
                {isLocalFallback
                  ? copy.practice.localFallbackSubtext
                  : "Generated based on assessment topics via Gemini API"}
              </p>
            </div>
          </div>
          {totalQuestions > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[var(--accent)]">
                {copy.practice.score(score, totalQuestions)}
              </span>
              <button
                type="button"
                onClick={handleRestart}
                aria-label={copy.practice.restart}
                title={copy.practice.restart}
                className="rounded-lg border border-[var(--border)] p-1 text-[var(--text-muted)] hover:bg-[var(--border)]/30 hover:text-[var(--text)]"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="mt-6">
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-[var(--text-muted)]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent mb-3" />
            <p>{copy.practice.loading}</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-semibold text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && totalQuestions === 0 && (
          <div className="py-8 text-center text-sm text-[var(--text-muted)]">
            {copy.practice.emptyQuestions}
          </div>
        )}

        {!loading && !error && totalQuestions > 0 && (
          <div className="space-y-6">
            {questions.map((q, qIndex) => {
              const selectedIdx = selectedAnswers[q.id];
              const isAnswered = selectedIdx !== undefined;
              const correctIdx = q.correctIndex ?? q.correct_index ?? 0;

              return (
                <div
                  key={q.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4 transition"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)] mb-2">
                    <span>{copy.practice.questionProgress(qIndex + 1, totalQuestions)}</span>
                    {isAnswered && (
                      <span
                        className={`font-bold ${
                          selectedIdx === correctIdx
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {selectedIdx === correctIdx
                          ? copy.practice.correctFeedback
                          : copy.practice.incorrectFeedback}
                      </span>
                    )}
                  </div>

                  <p className="font-semibold text-sm text-[var(--text)] mb-3">
                    {q.question || (q as unknown as { text?: string }).text}
                  </p>

                  {/* Options List */}
                  <div className="space-y-2">
                    {q.options.map((opt, optIndex) => {
                      let btnStyle =
                        "border-[var(--border)] hover:bg-[var(--border)]/30 text-[var(--text)]";
                      let indicator = null;

                      if (isAnswered) {
                        if (optIndex === correctIdx) {
                          btnStyle =
                            "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold";
                          indicator = <Check className="h-4 w-4 text-emerald-600 shrink-0" />;
                        } else if (optIndex === selectedIdx) {
                          btnStyle =
                            "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300 font-semibold";
                          indicator = <X className="h-4 w-4 text-red-600 shrink-0" />;
                        } else {
                          btnStyle =
                            "border-[var(--border)]/40 text-[var(--text-muted)] opacity-60";
                        }
                      }

                      return (
                        <button
                          key={optIndex}
                          type="button"
                          disabled={isAnswered}
                          onClick={() => handleSelectOption(q.id, optIndex)}
                          className={`w-full flex items-center justify-between rounded-xl border p-3 text-left text-xs transition ${btnStyle}`}
                        >
                          <span>{opt}</span>
                          {indicator}
                        </button>
                      );
                    })}
                  </div>

                  {/* Explanation (revealed upon selection) */}
                  {isAnswered && q.explanation && (
                    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-muted)] animate-fadeIn">
                      <span className="font-semibold text-[var(--text)] block mb-1">
                        {copy.practice.explanationHeader}
                      </span>
                      {q.explanation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-end border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
        >
          {copy.common.close}
        </button>
      </div>
    </div>
  );
}
