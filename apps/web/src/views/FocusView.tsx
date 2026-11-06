import React, { useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  HelpCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import { copy } from "../copy";
import { stripCoursePrefix } from "../lib/calendarLanes";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../lib/coursePalette";
import { useAppStore } from "../state/store";
import type { PracticeQuizPayload } from "../state/types";

type FocusTab = "pomodoro" | "practice";
type TimerMode = "pomodoro" | "shortBreak" | "longBreak";

const DURATIONS: Record<TimerMode, number> = {
  pomodoro: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

export const FocusView: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const assessments = useAppStore((s) => s.data.assessments);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const recommendations = useAppStore((s) => s.data.dashboard.studyRecommendations);
  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const practiceGenerate = useAppStore((s) => s.practiceGenerate);
  const openModal = useAppStore((s) => s.openModal);
  const openEventModal = useAppStore((s) => s.openEventModal);
  const addToast = useAppStore((s) => s.addToast);

  const upcomingAssessments = assessments.filter((a) => a.isUpcoming);
  const selectableAssessments = upcomingAssessments.length > 0 ? upcomingAssessments : assessments;

  const [activeTab, setActiveTab] = useState<FocusTab>("pomodoro");
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>(
    () => selectableAssessments[0]?.id || "",
  );

  useEffect(() => {
    if (!selectedAssessmentId && selectableAssessments.length > 0) {
      setSelectedAssessmentId(selectableAssessments[0].id);
    } else if (
      selectedAssessmentId &&
      selectableAssessments.length > 0 &&
      !selectableAssessments.some((a) => a.id === selectedAssessmentId)
    ) {
      setSelectedAssessmentId(selectableAssessments[0].id);
    }
  }, [selectableAssessments, selectedAssessmentId]);

  const activeAssessment = selectableAssessments.find((a) => a.id === selectedAssessmentId) || null;
  const activeRec = recommendations.find((r) => r.assessmentId === activeAssessment?.id) || null;

  // Pomodoro state
  const [timerMode, setTimerMode] = useState<TimerMode>("pomodoro");
  const [timeLeft, setTimeLeft] = useState<number>(DURATIONS.pomodoro);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [customIntention, setCustomIntention] = useState("");

  const playChime = () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.8);
    } catch {
      // AudioContext unavailable
    }
  };

  useEffect(() => {
    if (!isRunning) return;
    if (timeLeft <= 0) {
      setIsRunning(false);
      playChime();
      addToast({ type: "success", message: copy.pomodoro.sessionComplete });
      return;
    }
    const id = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning, timeLeft, addToast]);

  const switchTimerMode = (next: TimerMode) => {
    setTimerMode(next);
    setTimeLeft(DURATIONS[next]);
    setIsRunning(false);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTimeLeft(DURATIONS[timerMode]);
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  };

  const totalSecs = DURATIONS[timerMode];
  const progressFraction = totalSecs > 0 ? (totalSecs - timeLeft) / totalSecs : 0;
  const ringRadius = 86;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const strokeDashoffset = ringCircumference * (1 - progressFraction);
  const starAngleRad = progressFraction * 2 * Math.PI;
  const starX = 100 + ringRadius * Math.cos(starAngleRad);
  const starY = 100 + ringRadius * Math.sin(starAngleRad);

  // Practice Quiz state
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizPayload, setQuizPayload] = useState<PracticeQuizPayload | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});

  useEffect(() => {
    if (activeTab !== "practice" || !activeAssessment) {
      return;
    }
    let cancelled = false;
    setQuizLoading(true);
    setQuizError(null);
    void practiceGenerate(activeAssessment.id)
      .then((res) => {
        if (!cancelled) {
          setQuizPayload(res);
          setSelectedAnswers({});
          setQuizLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setQuizError(err instanceof Error ? err.message : String(err));
          setQuizLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, activeAssessment, practiceGenerate]);

  const questions = quizPayload?.questions || [];
  const score = questions.reduce((acc, q) => {
    const chosen = selectedAnswers[q.id];
    const correct = q.correctIndex ?? q.correct_index ?? 0;
    return chosen !== undefined && chosen === correct ? acc + 1 : acc;
  }, 0);

  const isLocalFallback =
    quizPayload?.authoredLocally ||
    quizPayload?.authored_locally ||
    (!quizPayload?.generatedByAi && !quizPayload?.generated_by_ai);

  const rawTopics =
    activeAssessment?.topics && activeAssessment.topics.length > 0
      ? activeAssessment.topics
      : activeRec?.topics.map((t) => t.title) || [];

  return (
    <div data-testid="focus-view" className="space-y-6">
      {/* Top Header & Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--surface-border)] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text)]">{copy.nav.focus}</h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Deep-work Pomodoro sessions and syllabus-grounded practice quizzes.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Focus study modes"
          className="inline-flex rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "pomodoro"}
            onClick={() => setActiveTab("pomodoro")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "pomodoro"
                ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.pomodoro.title}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "practice"}
            onClick={() => setActiveTab("practice")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "practice"
                ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.practice.title}</span>
          </button>
        </div>
      </div>

      {/* Target Exam Selector Bar */}
      {selectableAssessments.length > 0 ? (
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Study Target Assessment
            </div>
            <select
              aria-label="Study Target Assessment"
              value={selectedAssessmentId}
              onChange={(e) => setSelectedAssessmentId(e.target.value)}
              className="rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-2 text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              {selectableAssessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {courseDisplayName(a.courseId, courses)} —{" "}
                  {stripCoursePrefix(a.title, a.courseId)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div
          data-testid="empty-focus"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--surface-border)] bg-[var(--surface)] p-4"
        >
          <div className="text-xs text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text)]">
              {copy.emptyStates.noFocusTaskSelected}
            </span>{" "}
            You can run a standalone Pomodoro timer below or add an exam to unlock syllabus topic
            tracking and practice quizzes.
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => openModal({ id: "add-course" })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--surface-border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.dashboard.studyEmptyAddCourse}</span>
            </button>
            <button
              type="button"
              onClick={() => openEventModal()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-fill-hover)] transition"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.sidebar.createEvent}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: POMODORO TIMER + SYLLABUS CHECKLIST */}
      {activeTab === "pomodoro" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Timer Card */}
          <div className="lg:col-span-7 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-6 shadow-xs flex flex-col items-center">
            <div className="flex w-full max-w-md rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-1">
              {(
                [
                  { id: "pomodoro", label: copy.pomodoro.modePomodoro },
                  { id: "shortBreak", label: copy.pomodoro.modeShortBreak },
                  { id: "longBreak", label: copy.pomodoro.modeLongBreak },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => switchTimerMode(m.id)}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                    timerMode === m.id
                      ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-xs"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Circular Ring + Countdown */}
            <div className="relative my-8 flex items-center justify-center">
              <svg className="h-52 w-52 -rotate-90" viewBox="0 0 200 200" aria-hidden="true">
                <circle
                  cx="100"
                  cy="100"
                  r={ringRadius}
                  fill="none"
                  stroke="var(--surface-border)"
                  strokeWidth="10"
                />
                <circle
                  cx="100"
                  cy="100"
                  r={ringRadius}
                  fill="none"
                  stroke="var(--accent-fill)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-300"
                />
                {progressFraction > 0 && (
                  <g transform={`translate(${starX}, ${starY})`} className="pointer-events-none">
                    <circle
                      r="6"
                      fill="var(--accent-fill)"
                      opacity="0.4"
                      className="animate-pulse motion-reduce:animate-none"
                    />
                    <circle r="3" fill="#FFFFFF" />
                  </g>
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  data-testid="focus-timer-readout"
                  className="font-mono text-5xl font-black tracking-tight tabular-nums text-[var(--text)]"
                >
                  {formatTime(timeLeft)}
                </span>
                <span className="mt-1 text-xs font-semibold text-[var(--text-muted)]">
                  {isRunning ? "Session in progress" : "Ready to focus"}
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={resetTimer}
                aria-label={copy.pomodoro.reset}
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--surface-border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition"
              >
                <RotateCcw className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setIsRunning((v) => !v)}
                className="flex h-12 min-w-36 items-center justify-center gap-2 rounded-xl bg-[var(--accent-fill)] px-6 text-sm font-bold text-white shadow-sm hover:bg-[var(--accent-fill-hover)] transition"
              >
                {isRunning ? (
                  <>
                    <Pause className="h-4 w-4" aria-hidden="true" />
                    <span>{copy.pomodoro.pause}</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    <span>{copy.pomodoro.start}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Syllabus Checklist Side Card */}
          <div className="lg:col-span-5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--surface-border)] pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
                <h2 className="text-sm font-bold text-[var(--text)]">Active Syllabus Topics</h2>
              </div>
              {activeAssessment && (
                <span className="text-xs font-semibold tabular-nums text-[var(--text-muted)]">
                  {activeRec?.topics.filter((t) => t.completed).length || 0}/
                  {activeRec?.topics.length ?? rawTopics.length} done
                </span>
              )}
            </div>

            {!activeAssessment ? (
              <div className="space-y-4">
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  Select or add an upcoming assessment to check off syllabus topics during your
                  Pomodoro blocks, or set an ad-hoc session intention below.
                </p>

                <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-3 space-y-2">
                  <label
                    htmlFor="adhoc-intention"
                    className="block text-[11px] font-bold text-[var(--text)] uppercase tracking-wider"
                  >
                    Current Focus Intention
                  </label>
                  <input
                    id="adhoc-intention"
                    type="text"
                    value={customIntention}
                    onChange={(e) => setCustomIntention(e.target.value)}
                    placeholder="e.g. Solve Chapter 4 Problem Set 2"
                    className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 text-center text-xs">
                  <div className="p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
                    <div className="text-[11px] text-[var(--text-muted)]">Target Interval</div>
                    <div className="font-bold text-[var(--text)] mt-0.5">25 mins</div>
                  </div>
                  <div className="p-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)]">
                    <div className="text-[11px] text-[var(--text-muted)]">Short Rest</div>
                    <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      5 mins
                    </div>
                  </div>
                </div>
              </div>
            ) : rawTopics.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] italic">
                No explicit syllabus topics extracted for this assessment yet.
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {rawTopics.map((topic, idx) => {
                  const completed =
                    activeRec?.topics.find((t) => t.topicIndex === idx)?.completed ?? false;
                  return (
                    <label
                      key={idx}
                      className="flex cursor-pointer select-none items-center gap-2.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-2.5 hover:bg-[var(--surface-hover)] transition"
                    >
                      <input
                        type="checkbox"
                        checked={completed}
                        onChange={() => toggleTopic(activeAssessment.id, idx)}
                        className="h-4 w-4 rounded accent-[var(--accent-fill)] shrink-0"
                      />
                      <span
                        className={`text-xs ${
                          completed
                            ? "line-through text-[var(--text-muted)] topic-shimmer-done"
                            : "font-medium text-[var(--text)]"
                        }`}
                      >
                        {topic}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PRACTICE QUIZ RUNNER */}
      {activeTab === "practice" && (
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 sm:p-6 shadow-xs space-y-5">
          {!activeAssessment ? (
            <div className="py-10 text-center text-xs text-[var(--text-muted)]">
              Add an assessment with syllabus topics to generate practice questions.
            </div>
          ) : (
            <>
              {/* Course pills for rapid switching */}
              {selectableAssessments.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {selectableAssessments.map((a) => {
                    const basePalette = coursePalette(a.courseId || "");
                    const enrolled = courses.find((c) => c.id === a.courseId);
                    const chip = courseAccessibleChip(
                      enrolled?.color || basePalette.color,
                      theme === "dark",
                    );
                    const isSelected = a.id === activeAssessment.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setSelectedAssessmentId(a.id)}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                          isSelected
                            ? "bg-[var(--accent-fill)] border-transparent text-white shadow-xs"
                            : "border-[var(--surface-border)] bg-[var(--page)] text-[var(--text)] hover:bg-[var(--surface-hover)]"
                        }`}
                      >
                        <span
                          className="mr-1.5 inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: isSelected ? "#ffffff" : chip.dot }}
                        />
                        {courseDisplayName(a.courseId, courses)}:{" "}
                        {stripCoursePrefix(a.title, a.courseId)}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Provenance & Score Header */}
              {quizPayload && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-3.5">
                  <div className="flex items-center gap-2.5">
                    {isLocalFallback ? (
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-bold text-[var(--text)]">
                        {isLocalFallback
                          ? copy.practice.localFallbackProvenance
                          : copy.practice.aiProvenance}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {isLocalFallback
                          ? copy.practice.localFallbackSubtext
                          : "Generated from syllabus topics via Gemini API"}
                      </div>
                    </div>
                  </div>

                  {questions.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold tabular-nums text-[var(--accent-ink)]">
                        {copy.practice.score(score, questions.length)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedAnswers({})}
                        aria-label={copy.practice.restart}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--surface-border)] px-2.5 py-1 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{copy.practice.restart}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {quizLoading && (
                <div className="py-10 text-center text-xs text-[var(--text-muted)]">
                  {copy.practice.loading}
                </div>
              )}

              {quizError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-semibold text-red-700 dark:text-red-300">
                  {quizError}
                </div>
              )}

              {!quizLoading && !quizError && questions.length === 0 && (
                <div className="py-8 text-center text-xs text-[var(--text-muted)]">
                  {copy.practice.emptyQuestions}
                </div>
              )}

              {!quizLoading && !quizError && questions.length > 0 && (
                <div className="space-y-4">
                  {questions.map((q, qIdx) => {
                    const selectedIdx = selectedAnswers[q.id];
                    const isAnswered = selectedIdx !== undefined;
                    const correctIdx = q.correctIndex ?? q.correct_index ?? 0;
                    return (
                      <div
                        key={q.id}
                        className="rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between text-xs font-semibold tabular-nums text-[var(--text-muted)]">
                          <span>{copy.practice.questionProgress(qIdx + 1, questions.length)}</span>
                          {isAnswered && (
                            <span
                              className={
                                selectedIdx === correctIdx
                                  ? "font-bold text-emerald-700 dark:text-emerald-300"
                                  : "font-bold text-red-700 dark:text-red-300"
                              }
                            >
                              {selectedIdx === correctIdx
                                ? copy.practice.correctFeedback
                                : copy.practice.incorrectFeedback}
                            </span>
                          )}
                        </div>

                        <p className="text-sm font-semibold text-[var(--text)]">
                          {q.question || (q as unknown as { text?: string }).text}
                        </p>

                        <div className="space-y-2">
                          {q.options.map((opt, optIdx) => {
                            let styleClass =
                              "border-[var(--surface-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-[var(--text)]";
                            let icon = null;
                            if (isAnswered) {
                              if (optIdx === correctIdx) {
                                styleClass =
                                  "border-emerald-600 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 font-semibold";
                                icon = (
                                  <Check
                                    className="h-4 w-4 text-emerald-700 dark:text-emerald-300 shrink-0"
                                    aria-hidden="true"
                                  />
                                );
                              } else if (optIdx === selectedIdx) {
                                styleClass =
                                  "border-red-600 bg-red-500/10 text-red-800 dark:text-red-200 font-semibold";
                                icon = (
                                  <X
                                    className="h-4 w-4 text-red-700 dark:text-red-300 shrink-0"
                                    aria-hidden="true"
                                  />
                                );
                              } else {
                                styleClass =
                                  "border-[color-mix(in_srgb,var(--surface-border)_60%,transparent)] bg-[var(--surface)] text-[var(--text-muted)]";
                              }
                            }
                            return (
                              <button
                                key={optIdx}
                                type="button"
                                disabled={isAnswered}
                                onClick={() =>
                                  setSelectedAnswers((prev) => ({ ...prev, [q.id]: optIdx }))
                                }
                                className={`flex w-full items-center justify-between rounded-xl border p-3 text-left text-xs transition ${styleClass}`}
                              >
                                <span>{opt}</span>
                                {icon}
                              </button>
                            );
                          })}
                        </div>

                        {isAnswered && q.explanation && (
                          <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-muted)]">
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
            </>
          )}
        </div>
      )}
    </div>
  );
};
