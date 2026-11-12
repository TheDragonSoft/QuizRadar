import { Play, Pause, RotateCcw, CheckCircle2, Timer, X } from "lucide-react";
import { copy } from "../copy";
import { useAppStore, POMODORO_DURATIONS } from "../state/store";
import { stripCoursePrefix } from "../lib/calendarLanes";

export interface PomodoroModalProps {
  assessmentId?: string;
  topicIndex?: number;
  topicTitle?: string;
}

export function PomodoroModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const modalProps = (props || {}) as PomodoroModalProps;
  const assessmentId = modalProps.assessmentId;
  const topicIndex = modalProps.topicIndex;
  const topicTitle = modalProps.topicTitle;

  const toggleTopic = useAppStore((s) => s.toggleTopic);
  const assessments = useAppStore((s) => s.data.assessments);
  const addToast = useAppStore((s) => s.addToast);

  // The modal is pure presentation over the SINGLE store timer — the same
  // timer the Focus view and the global Space key control. It used to carry
  // a fully independent local timer (own state, own interval, own chime, own
  // session recording), so two timers could run concurrently and a session
  // completed in the modal was recorded while the store timer kept running.
  const mode = useAppStore((s) => s.pomodoroMode);
  const timeLeft = useAppStore((s) => s.pomodoroSecondsLeft);
  const isRunning = useAppStore((s) => s.pomodoroIsRunning);
  const togglePomodoro = useAppStore((s) => s.togglePomodoro);
  const resetPomodoro = useAppStore((s) => s.resetPomodoro);
  const setPomodoroMode = useAppStore((s) => s.setPomodoroMode);

  const matchedAssessment = assessments.find((a) => a.id === assessmentId);

  const switchMode = (newMode: keyof typeof POMODORO_DURATIONS) => {
    setPomodoroMode(newMode);
  };

  const handleReset = () => {
    resetPomodoro();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const totalDuration = POMODORO_DURATIONS[mode];
  const progressFraction = Math.max(0, Math.min(1, (totalDuration - timeLeft) / totalDuration));
  const ringRadius = 84;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const strokeDashoffset = ringCircumference * (1 - progressFraction);
  const angleRad = progressFraction * 2 * Math.PI - Math.PI / 2;
  const starX = 100 + ringRadius * Math.cos(angleRad);
  const starY = 100 + ringRadius * Math.sin(angleRad);

  const handleMarkTopicDone = () => {
    if (assessmentId && topicIndex !== undefined) {
      toggleTopic(assessmentId, topicIndex);
      addToast({
        type: "success",
        message: copy.pomodoro.topicMarkedDone(topicTitle || "Study Topic"),
      });
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <Timer className="h-4 w-4" />
          </div>
          <h2 id="pomodoro-modal-title" className="text-lg font-bold text-[var(--text)]">
            {copy.pomodoro.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Target Assessment / Topic Chip */}
      {(matchedAssessment || topicTitle) && (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--page)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Active Study Target
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <div>
              {matchedAssessment && (
                <span className="font-semibold text-[var(--text)]">
                  {stripCoursePrefix(matchedAssessment.title, matchedAssessment.courseId)}
                  {matchedAssessment.courseName || matchedAssessment.courseId
                    ? ` — ${matchedAssessment.courseName || matchedAssessment.courseId}`
                    : ""}
                </span>
              )}
              {topicTitle && (
                <div className="text-xs text-[var(--text-muted)] mt-0.5">Topic: {topicTitle}</div>
              )}
            </div>
            {assessmentId && topicIndex !== undefined && (
              <button
                type="button"
                onClick={handleMarkTopicDone}
                aria-label={copy.pomodoro.markTopicDone}
                title={copy.pomodoro.markTopicDone}
                className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Mark Done</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mode Switcher */}
      <div className="mt-6 flex rounded-xl border border-[var(--border)] bg-[var(--page)] p-1">
        <button
          type="button"
          onClick={() => switchMode("pomodoro")}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
            mode === "pomodoro"
              ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {copy.pomodoro.modePomodoro}
        </button>
        <button
          type="button"
          onClick={() => switchMode("shortBreak")}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
            mode === "shortBreak"
              ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {copy.pomodoro.modeShortBreak}
        </button>
        <button
          type="button"
          onClick={() => switchMode("longBreak")}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
            mode === "longBreak"
              ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {copy.pomodoro.modeLongBreak}
        </button>
      </div>

      {/* Large Digital Timer Display & Circular Bar */}
      <div className="mt-6 flex flex-col items-center justify-center">
        <div className="relative flex h-52 w-52 items-center justify-center">
          <svg className="h-full w-full" viewBox="0 0 200 200" aria-hidden="true">
            <circle
              cx="100"
              cy="100"
              r={ringRadius}
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              className="text-slate-200 dark:text-slate-800"
            />
            <circle
              cx="100"
              cy="100"
              r={ringRadius}
              stroke="var(--accent-fill)"
              strokeWidth="8"
              strokeLinecap="round"
              fill="none"
              strokeDasharray={ringCircumference}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 100 100)"
              className="transition-all duration-500 ease-out"
            />
            {progressFraction > 0 && (
              <g transform={`translate(${starX}, ${starY})`} className="pointer-events-none">
                <circle
                  r="6"
                  fill="var(--accent-fill)"
                  opacity="0.5"
                  className="animate-pulse motion-reduce:animate-none"
                />
                <circle r="3" fill="#FFFFFF" />
              </g>
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-4xl font-black tracking-tight text-[var(--text)] tabular-nums font-mono">
              {formatTime(timeLeft)}
            </div>
            <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mt-1">
              {isRunning ? "FOCUSING" : "READY"}
            </div>
          </div>
        </div>
      </div>

      {/* Timer Controls */}
      <div className="mt-8 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={handleReset}
          aria-label={copy.pomodoro.reset}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition"
        >
          <RotateCcw className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={togglePomodoro}
          className="flex h-14 w-28 items-center justify-center gap-2 rounded-2xl bg-[var(--accent-fill)] font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-[var(--accent-fill-hover)] transition"
        >
          {isRunning ? (
            <>
              <Pause className="h-5 w-5" />
              <span>{copy.pomodoro.pause}</span>
            </>
          ) : (
            <>
              <Play className="h-5 w-5 fill-current ml-0.5" />
              <span>{copy.pomodoro.start}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
