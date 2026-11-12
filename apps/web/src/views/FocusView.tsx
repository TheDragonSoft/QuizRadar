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
  Layers,
  AlertCircle,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Trash2,
} from "lucide-react";
import { copy } from "../copy";
import { stripCoursePrefix } from "../lib/calendarLanes";
import { courseAccessibleChip, courseDisplayName, coursePalette } from "../lib/coursePalette";
import { useAppStore, POMODORO_DURATIONS } from "../state/store";
import { isDarkTheme } from "../state/storage";
import { StudyStatsCard } from "../components/StudyStatsCard";
import type { PracticeQuizPayload } from "../state/types";

type FocusTab = "pomodoro" | "practice" | "flashcards" | "mistakes";
type TimerMode = "pomodoro" | "shortBreak" | "longBreak";

export const FocusView: React.FC = () => {
  const theme = useAppStore((s) => s.theme);
  const assessments = useAppStore((s) => s.data?.assessments ?? []);
  const courses = useAppStore((s) => s.data?.schedule?.courses ?? []);
  const recommendations = useAppStore((s) => s.data?.dashboard?.studyRecommendations ?? []);
  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const practiceGenerate = useAppStore((s) => s.practiceGenerate);
  const openModal = useAppStore((s) => s.openModal);
  const openEventModal = useAppStore((s) => s.openEventModal);
  const addToast = useAppStore((s) => s.addToast);

  // Pomodoro state unified with Zustand store (controlled app-wide by Space)
  const isRunning = useAppStore((s) => s.pomodoroIsRunning);
  const timeLeft = useAppStore((s) => s.pomodoroSecondsLeft);
  const timerMode = useAppStore((s) => s.pomodoroMode);
  const togglePomodoro = useAppStore((s) => s.togglePomodoro);
  const resetPomodoro = useAppStore((s) => s.resetPomodoro);
  const setPomodoroMode = useAppStore((s) => s.setPomodoroMode);

  // Flashcards state
  const flashcards = useAppStore((s) => s.flashcards ?? []);
  const upsertFlashcard = useAppStore((s) => s.upsertFlashcard);
  const deleteFlashcard = useAppStore((s) => s.deleteFlashcard);
  const reviewFlashcard = useAppStore((s) => s.reviewFlashcard);

  // Mistake bank state
  const mistakeBank = useAppStore((s) => s.mistakeBank ?? []);
  const addMistake = useAppStore((s) => s.addMistake);
  const resolveMistake = useAppStore((s) => s.resolveMistake);

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

  const [customIntention, setCustomIntention] = useState("");

  // Pure presentation over the SINGLE store timer. The tick driver is
  // app-level (startPomodoroTicker in App.tsx) — this view used to own the
  // only setInterval, which froze the session the moment the user navigated
  // away. Completion lives in the store transition (exactly once).

  const switchTimerMode = (next: TimerMode) => {
    setPomodoroMode(next);
  };

  const resetTimer = () => {
    resetPomodoro();
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  };

  const totalSecs = POMODORO_DURATIONS[timerMode];
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

  // Filter flashcards for active assessment / course
  const relevantCards = flashcards.filter(
    (c) =>
      !activeAssessment ||
      c.assessmentId === activeAssessment.id ||
      c.courseId === activeAssessment.courseId,
  );

  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [newCardTopic, setNewCardTopic] = useState("");
  const [newCardFront, setNewCardFront] = useState("");
  const [newCardBack, setNewCardBack] = useState("");

  // Keep card index bounded
  useEffect(() => {
    if (cardIndex >= relevantCards.length && relevantCards.length > 0) {
      setCardIndex(relevantCards.length - 1);
      setIsFlipped(false);
    }
  }, [relevantCards.length, cardIndex]);

  const currentCard = relevantCards[cardIndex] || null;

  // Filter mistakes
  const relevantMistakes = mistakeBank.filter(
    (m) =>
      !activeAssessment ||
      m.assessmentId === activeAssessment.id ||
      m.courseId === activeAssessment.courseId,
  );
  const unresolvedMistakes = relevantMistakes.filter((m) => !m.resolved);
  const [mistakeFilter, setMistakeFilter] = useState<"unresolved" | "all">("unresolved");

  const displayedMistakes = mistakeFilter === "unresolved" ? unresolvedMistakes : relevantMistakes;

  // Seed flashcards from syllabus topics
  const handleSeedTopics = () => {
    if (!activeAssessment || rawTopics.length === 0) return;
    rawTopics.forEach((t) => {
      upsertFlashcard({
        courseId: activeAssessment.courseId,
        assessmentId: activeAssessment.id,
        topic: t,
        front: `Core Concept: ${t}`,
        back: `Key definitions, formulas, and common exam questions associated with ${t}. Review corresponding lecture notes.`,
        boxLevel: 1,
      });
    });
    addToast({
      type: "success",
      message: `Created ${rawTopics.length} flashcards from syllabus topics.`,
    });
  };

  const handleCreateCustomCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCardFront.trim() || !newCardBack.trim()) return;
    upsertFlashcard({
      courseId: activeAssessment?.courseId || courses[0]?.id || "study",
      assessmentId: activeAssessment?.id || undefined,
      topic: newCardTopic.trim() || "General Concept",
      front: newCardFront.trim(),
      back: newCardBack.trim(),
      boxLevel: 1,
    });
    setNewCardFront("");
    setNewCardBack("");
    setNewCardTopic("");
    setShowAddCard(false);
    addToast({
      type: "success",
      message: "Custom flashcard saved to study deck.",
    });
  };

  return (
    <div data-testid="focus-view" className="space-y-6">
      {/* Top Header & Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--surface-border)] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text)]">{copy.nav.focus}</h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Deep-work Pomodoro sessions, interactive flashcards, practice quizzes, and mistake
            revision.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Focus study modes"
          className="inline-flex rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-1 flex-wrap gap-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "pomodoro"}
            onClick={() => setActiveTab("pomodoro")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
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
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === "practice"
                ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.practice.title}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "flashcards"}
            onClick={() => setActiveTab("flashcards")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === "flashcards"
                ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Flashcards</span>
            {relevantCards.length > 0 && (
              <span className="rounded-full bg-[var(--surface-border)] px-1.5 py-0.2 text-[10px] font-bold tabular-nums">
                {relevantCards.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "mistakes"}
            onClick={() => setActiveTab("mistakes")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === "mistakes"
                ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-xs"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Mistake Bank</span>
            {unresolvedMistakes.length > 0 && (
              <span className="rounded-full bg-red-500/20 text-red-600 dark:text-red-400 px-1.5 py-0.2 text-[10px] font-bold tabular-nums">
                {unresolvedMistakes.length}
              </span>
            )}
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
            tracking, flashcards, and practice quizzes.
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
                  {isRunning
                    ? "Session in progress (Space to pause)"
                    : "Ready to focus (Space to start)"}
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
                onClick={togglePomodoro}
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
                      isDarkTheme(theme),
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
                    const isWrong = isAnswered && selectedIdx !== correctIdx;

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
                                onClick={() => {
                                  setSelectedAnswers((prev) => ({ ...prev, [q.id]: optIdx }));
                                  if (optIdx !== correctIdx) {
                                    addMistake({
                                      courseId: activeAssessment.courseId,
                                      assessmentId: activeAssessment.id,
                                      topic: activeRec?.topics[0]?.title || undefined,
                                      questionId: q.id,
                                      questionText:
                                        q.question ||
                                        (q as unknown as { text?: string }).text ||
                                        "",
                                      options: q.options,
                                      selectedIndex: optIdx,
                                      correctIndex: correctIdx,
                                      explanation:
                                        q.explanation || "Review key concepts from this chapter.",
                                      timestamp: new Date().toISOString(),
                                      resolved: false,
                                    });
                                  }
                                }}
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

                        {isWrong && (
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                              Logged to Mistake Bank
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                addMistake({
                                  courseId: activeAssessment.courseId,
                                  assessmentId: activeAssessment.id,
                                  topic: activeRec?.topics[0]?.title || undefined,
                                  questionId: q.id,
                                  questionText:
                                    q.question || (q as unknown as { text?: string }).text || "",
                                  options: q.options,
                                  selectedIndex: selectedIdx,
                                  correctIndex: correctIdx,
                                  explanation: q.explanation || "Review course syllabus topics.",
                                  timestamp: new Date().toISOString(),
                                  resolved: false,
                                });
                                addToast({
                                  type: "info",
                                  message: "Question bookmarked in Mistake Bank.",
                                });
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-500/20 transition cursor-pointer"
                            >
                              <BookmarkPlus className="h-3 w-3" aria-hidden="true" />
                              <span>Bookmark to Mistakes</span>
                            </button>
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

      {/* TAB 3: INTERACTIVE FLASHCARD REVIEW */}
      {activeTab === "flashcards" && (
        <div
          data-testid="flashcards-section"
          className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 sm:p-6 shadow-xs space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--surface-border)] pb-4">
            <div>
              <h2 className="text-base font-bold text-[var(--text)] flex items-center gap-2">
                <Layers className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
                <span>Leitner Spaced Repetition Flashcards</span>
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Active recall with 5-box spaced repetition. Mastered cards advance to higher boxes
                with longer intervals.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {rawTopics.length > 0 && relevantCards.length === 0 && (
                <button
                  type="button"
                  onClick={handleSeedTopics}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent)]/20 transition cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Seed from Topics</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAddCard((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{showAddCard ? "Close Form" : "Add Flashcard"}</span>
              </button>
            </div>
          </div>

          {/* New Flashcard Form */}
          {showAddCard && (
            <form
              onSubmit={handleCreateCustomCard}
              className="rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-4 space-y-3"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Create New Flashcard
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="card-topic"
                    className="block text-[11px] font-bold text-[var(--text)] mb-1"
                  >
                    Topic / Concept Area
                  </label>
                  <input
                    id="card-topic"
                    type="text"
                    value={newCardTopic}
                    onChange={(e) => setNewCardTopic(e.target.value)}
                    placeholder="e.g. Logic Gates, Integration by Parts"
                    className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="card-front"
                  className="block text-[11px] font-bold text-[var(--text)] mb-1"
                >
                  Card Front (Question / Term) *
                </label>
                <textarea
                  id="card-front"
                  rows={2}
                  required
                  value={newCardFront}
                  onChange={(e) => setNewCardFront(e.target.value)}
                  placeholder="State De Morgan's Laws or define Boolean duality..."
                  className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] resize-y"
                />
              </div>
              <div>
                <label
                  htmlFor="card-back"
                  className="block text-[11px] font-bold text-[var(--text)] mb-1"
                >
                  Card Back (Answer / Explanation) *
                </label>
                <textarea
                  id="card-back"
                  rows={3}
                  required
                  value={newCardBack}
                  onChange={(e) => setNewCardBack(e.target.value)}
                  placeholder="Detailed answer, derivation, or formula..."
                  className="w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] resize-y"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddCard(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--accent-fill)] px-4 py-1.5 text-xs font-bold text-white hover:bg-[var(--accent-fill-hover)] transition cursor-pointer"
                >
                  Save Card
                </button>
              </div>
            </form>
          )}

          {relevantCards.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <Layers
                className="h-10 w-10 text-[var(--text-muted)] mx-auto opacity-50"
                aria-hidden="true"
              />
              <div className="text-sm font-bold text-[var(--text)]">No Flashcards in this Deck</div>
              <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
                Seed cards directly from your syllabus topics or create custom cards to begin active
                recall practice.
              </p>
              {rawTopics.length > 0 && (
                <button
                  type="button"
                  onClick={handleSeedTopics}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-bold text-white hover:bg-[var(--accent-fill-hover)] transition cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Seed from Syllabus Topics</span>
                </button>
              )}
            </div>
          ) : currentCard ? (
            <div className="max-w-xl mx-auto space-y-4">
              {/* Card Meta & Navigation Bar */}
              <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">
                    Card {cardIndex + 1} of {relevantCards.length}
                  </span>
                  <span className="rounded-full bg-[var(--surface-border)] px-2 py-0.5 text-[11px] font-bold text-[var(--text)]">
                    Box {currentCard.boxLevel}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    deleteFlashcard(currentCard.id);
                    addToast({ type: "info", message: "Flashcard deleted." });
                  }}
                  aria-label="Delete flashcard"
                  className="p-1 rounded text-[var(--text-muted)] hover:text-red-500 transition cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* The Flip Card */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Flip flashcard"
                onClick={() => setIsFlipped((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIsFlipped((v) => !v);
                  }
                }}
                className={`relative min-h-[220px] rounded-2xl border p-6 flex flex-col justify-between cursor-pointer transition shadow-xs select-none ${
                  isFlipped
                    ? "border-[var(--accent)] bg-[var(--page)] shadow-md"
                    : "border-[var(--surface-border)] bg-[var(--surface)] hover:border-[var(--accent)]/50"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-ink)]">
                      {isFlipped ? "Answer / Explanation" : "Question / Concept"}
                    </span>
                    <span className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                      {currentCard.topic || "Core Topic"}
                    </span>
                  </div>

                  <p className="text-base font-semibold text-[var(--text)] leading-relaxed whitespace-pre-wrap">
                    {isFlipped ? currentCard.back : currentCard.front}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-[var(--surface-border)] text-xs text-[var(--text-muted)]">
                  <span className="flex items-center gap-1">
                    <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Click or press Enter/Space to flip</span>
                  </span>
                  <span className="text-[11px] font-medium">{isFlipped ? "Side B" : "Side A"}</span>
                </div>
              </div>

              {/* Leitner Rating Actions */}
              {isFlipped ? (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      reviewFlashcard(currentCard.id, false);
                      addMistake({
                        courseId: currentCard.courseId || courses[0]?.id || "study",
                        assessmentId:
                          currentCard.assessmentId || activeAssessment?.id || "flashcards",
                        topic: currentCard.topic || undefined,
                        questionId: currentCard.id,
                        questionText: currentCard.front,
                        options: [currentCard.back, "Needs Review"],
                        selectedIndex: 1,
                        correctIndex: 0,
                        explanation: currentCard.back,
                        timestamp: new Date().toISOString(),
                        resolved: false,
                      });
                      addToast({
                        type: "info",
                        message: "Reset to Box 1 — logged in Mistake Bank.",
                      });
                      setIsFlipped(false);
                      if (cardIndex < relevantCards.length - 1) {
                        setCardIndex((i) => i + 1);
                      }
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 py-2.5 text-xs font-bold text-red-700 dark:text-red-300 hover:bg-red-500/20 transition cursor-pointer"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    <span>Needs Review (Box 1)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      reviewFlashcard(currentCard.id, true);
                      addToast({
                        type: "success",
                        message: `Mastered! Advanced to Box ${Math.min(5, currentCard.boxLevel + 1)}.`,
                      });
                      setIsFlipped(false);
                      if (cardIndex < relevantCards.length - 1) {
                        setCardIndex((i) => i + 1);
                      }
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition cursor-pointer"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    <span>Mastered (Advance Box)</span>
                  </button>
                </div>
              ) : (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => setIsFlipped(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)] px-6 py-2.5 text-xs font-bold text-[var(--accent-ink)] hover:bg-[var(--surface-hover)] transition cursor-pointer"
                  >
                    <RotateCw className="h-4 w-4" aria-hidden="true" />
                    <span>Reveal Answer</span>
                  </button>
                </div>
              )}

              {/* Prev / Next Deck Steppers */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={cardIndex === 0}
                  onClick={() => {
                    setCardIndex((i) => Math.max(0, i - 1));
                    setIsFlipped(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] disabled:opacity-40 transition cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  <span>Previous</span>
                </button>

                <button
                  type="button"
                  disabled={cardIndex >= relevantCards.length - 1}
                  onClick={() => {
                    setCardIndex((i) => Math.min(relevantCards.length - 1, i + 1));
                    setIsFlipped(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-xl border border-[var(--surface-border)] bg-[var(--page)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] disabled:opacity-40 transition cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* TAB 4: MISTAKE BANK & ERROR LOG */}
      {activeTab === "mistakes" && (
        <div
          data-testid="mistake-bank-section"
          className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 sm:p-6 shadow-xs space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--surface-border)] pb-4">
            <div>
              <h2 className="text-base font-bold text-[var(--text)] flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" aria-hidden="true" />
                <span>Mistake Bank &amp; Revision Log</span>
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Automatically records questions and concepts missed during practice quizzes and
                flashcard reviews.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMistakeFilter("unresolved")}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  mistakeFilter === "unresolved"
                    ? "bg-[var(--accent-fill)] text-white shadow-xs"
                    : "border border-[var(--surface-border)] bg-[var(--page)] text-[var(--text)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                Unresolved ({unresolvedMistakes.length})
              </button>
              <button
                type="button"
                onClick={() => setMistakeFilter("all")}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  mistakeFilter === "all"
                    ? "bg-[var(--accent-fill)] text-white shadow-xs"
                    : "border border-[var(--surface-border)] bg-[var(--page)] text-[var(--text)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                All History ({relevantMistakes.length})
              </button>
            </div>
          </div>

          {displayedMistakes.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <CheckCircle2
                className="h-10 w-10 text-emerald-500 mx-auto opacity-70"
                aria-hidden="true"
              />
              <div className="text-sm font-bold text-[var(--text)]">No Mistakes Found</div>
              <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
                {mistakeFilter === "unresolved"
                  ? "All caught up! You have resolved all recorded errors for this assessment."
                  : "No mistakes logged yet. Practice quizzes and flashcards marked 'Needs Review' will be tracked here."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {displayedMistakes.map((m) => {
                const course = courses.find((c) => c.id === m.courseId);
                const palette = coursePalette(m.courseId || courses[0]?.id || "study");
                const chip = courseAccessibleChip(
                  course?.color || palette.color,
                  isDarkTheme(theme),
                );

                return (
                  <div
                    key={m.id}
                    data-testid={`mistake-item-${m.id}`}
                    className={`rounded-xl border p-4 space-y-3 transition ${
                      m.resolved
                        ? "border-[var(--surface-border)] bg-[var(--page)] opacity-75"
                        : "border-red-500/30 bg-red-500/5 shadow-2xs"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-bold border"
                          style={{
                            backgroundColor: chip.bg,
                            color: chip.text,
                            borderColor: chip.border,
                          }}
                        >
                          {courseDisplayName(m.courseId, courses)}
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          Recorded{" "}
                          {m.timestamp ? new Date(m.timestamp).toLocaleDateString() : "Recently"}
                        </span>
                      </div>

                      {m.resolved ? (
                        <span className="rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 text-[11px] font-bold">
                          ✓ Resolved
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-500/10 text-red-700 dark:text-red-300 px-2.5 py-0.5 text-[11px] font-bold">
                          ⚠️ Needs Review
                        </span>
                      )}
                    </div>

                    <div className="text-sm font-semibold text-[var(--text)] leading-snug">
                      {m.questionText}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="p-2.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-800 dark:text-red-200">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 mb-0.5">
                          Your Answer:
                        </div>
                        {m.options[m.selectedIndex] || "Selected option"}
                      </div>

                      <div className="p-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-0.5">
                          Correct Answer:
                        </div>
                        {m.options[m.correctIndex] || m.explanation}
                      </div>
                    </div>

                    {m.explanation && (
                      <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] p-2.5 text-xs text-[var(--text-muted)]">
                        <span className="font-semibold text-[var(--text)] block mb-0.5">
                          Explanation:
                        </span>
                        {m.explanation}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--surface-border)]">
                      {!m.resolved && (
                        <button
                          type="button"
                          onClick={() => {
                            resolveMistake(m.id);
                            addToast({
                              type: "success",
                              message: "Mistake marked as resolved.",
                            });
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Mark Resolved</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Local-First Study Stats Card */}
      <StudyStatsCard className="mt-2" />
    </div>
  );
};
