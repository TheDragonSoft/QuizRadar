import { useState, useEffect } from "react";
import { Play, Pause, RotateCcw, CheckCircle2, Bell, X } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
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

  const matchedAssessment = assessments.find((a) => a.id === assessmentId);

  type TimerMode = "pomodoro" | "shortBreak" | "longBreak";
  const DURATIONS: Record<TimerMode, number> = {
    pomodoro: 25 * 60,
    shortBreak: 5 * 60,
    longBreak: 15 * 60,
  };

  const [mode, setMode] = useState<TimerMode>("pomodoro");
  const [timeLeft, setTimeLeft] = useState<number>(DURATIONS.pomodoro);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // WebAudio chime synthesizer
  const playChime = () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Note 1: 587.33 Hz (D5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.2, now + 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.8);

      // Note 2: 880.00 Hz (A5)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(880.0, now + 0.2);
      gain2.gain.setValueAtTime(0, now + 0.2);
      gain2.gain.linearRampToValueAtTime(0.25, now + 0.25);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.2);
      osc2.stop(now + 1.2);
    } catch {
      // AudioContext unavailable or blocked by autoplay policy
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRunning && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (isRunning && timeLeft === 0) {
      setIsRunning(false);
      playChime();
      addToast({
        type: "success",
        message: copy.pomodoro.sessionComplete,
      });
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, timeLeft, addToast]);

  const switchMode = (newMode: TimerMode) => {
    setMode(newMode);
    setTimeLeft(DURATIONS[newMode]);
    setIsRunning(false);
  };

  const handleReset = () => {
    setIsRunning(false);
    setTimeLeft(DURATIONS[mode]);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const totalDuration = DURATIONS[mode];
  const progressPercent = Math.round(((totalDuration - timeLeft) / totalDuration) * 100);

  const handleMarkTopicDone = () => {
    if (assessmentId && topicIndex !== undefined) {
      toggleTopic(assessmentId, topicIndex);
      addToast({
        type: "success",
        message: `Topic marked completed: ${topicTitle || "Study Topic"}`,
      });
    }
  };

  return (
    <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
            <Bell className="h-4 w-4" />
          </div>
          <h2 id="pomodoro-modal-title" className="text-lg font-bold text-[var(--text)]">
            {copy.pomodoro.title}
          </h2>
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
                  {matchedAssessment.courseId ? `[${matchedAssessment.courseId}] ` : ""}
                  {stripCoursePrefix(matchedAssessment.title, matchedAssessment.courseId)}
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
                className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
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
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
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
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
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
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {copy.pomodoro.modeLongBreak}
        </button>
      </div>

      {/* Large Digital Timer Display & Circular Bar */}
      <div className="mt-8 flex flex-col items-center justify-center">
        <div className="text-6xl font-black tracking-tight text-[var(--text)] tabular-nums font-mono">
          {formatTime(timeLeft)}
        </div>
        <div className="mt-4 w-full max-w-xs overflow-hidden rounded-full bg-[var(--border)]/40 h-2">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Timer Controls */}
      <div className="mt-8 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={handleReset}
          aria-label={copy.pomodoro.reset}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--border)]/20 hover:text-[var(--text)] transition"
        >
          <RotateCcw className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setIsRunning(!isRunning)}
          className="flex h-14 w-28 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-[var(--accent-hover)] transition"
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
