import { useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Upload,
  LogOut,
  X,
  Plus,
  Trash2,
  Sun,
  Moon,
} from "lucide-react";
import { copy } from "../copy";
import { isTauriEnvironment } from "../state/rpc";
import { useAppStore } from "../state/store";
import { COURSE_PALETTE_PRESETS } from "../lib/coursePalette";
import { GoogleMark, MicrosoftMark } from "./BrandMarks";
import type { Course } from "../state/types";

export function OnboardingWizardModal({
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const auth = useAppStore((s) => s.data.auth);
  const config = useAppStore((s) => s.data.config);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const updateConfig = useAppStore((s) => s.updateConfig);
  const upsertCourse = useAppStore((s) => s.upsertCourse);
  const deleteCourse = useAppStore((s) => s.deleteCourse);
  const triggerSync = useAppStore((s) => s.triggerSync);
  const googleLogin = useAppStore((s) => s.googleLogin);
  const googleLogout = useAppStore((s) => s.googleLogout);
  const microsoftLogin = useAppStore((s) => s.microsoftLogin);
  const microsoftLogout = useAppStore((s) => s.microsoftLogout);
  const validateGeminiKey = useAppStore((s) => s.validateGeminiKey);
  const extractSchedule = useAppStore((s) => s.extractSchedule);
  const importBackupFile = useAppStore((s) => s.importBackupFile);
  const openModal = useAppStore((s) => s.openModal);
  const addToast = useAppStore((s) => s.addToast);

  // Step 1: Profile & Rhythm State
  const [userName, setUserName] = useState(config.userName || auth.name || "");
  const [userEmail, setUserEmail] = useState(config.userEmail || auth.email || "");
  const [selectedTrack, setSelectedTrack] = useState<string>("eng");
  const [migrationSummary, setMigrationSummary] = useState<string | null>(null);

  const handleImportV4File = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const report = await importBackupFile(undefined, text);
      const summary = `Restored: ${report.coursesImported} courses, ${report.assessmentsImported} assessments, ${report.gradesImported} grades, ${report.topicsImported} completed topics.${report.secretsIgnored.length > 0 ? ` (${report.secretsIgnored.length} legacy secrets dropped)` : ""}`;
      setMigrationSummary(summary);
      addToast({ type: "success", message: summary });
    } catch (err) {
      addToast({
        type: "error",
        message: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // Step 2: Connections State
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiValidating, setGeminiValidating] = useState(false);
  const [geminiValid, setGeminiValid] = useState(config.geminiEnabled);
  const [moodleUrl, setMoodleUrl] = useState(config.moodleUrl || "");
  const [moodleIcalUrl, setMoodleIcalUrl] = useState(config.moodleIcalUrl || "");
  const classroomEnabled = config.classroomEnabled;
  const [autoSyncGcal, setAutoSyncGcal] = useState(false); // Default false per Rule 4
  const [extractingTimetable, setExtractingTimetable] = useState(false);

  // Step 3: Course Manual Adder State
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COURSE_PALETTE_PRESETS[0]);

  // Handle Gemini Key Validation
  const handleValidateGemini = async () => {
    if (!geminiKey.trim()) return;
    setGeminiValidating(true);
    try {
      const res = await validateGeminiKey(geminiKey.trim());
      if (res.valid) {
        setGeminiValid(true);
        await updateConfig({ geminiEnabled: true });
        addToast({
          type: "success",
          message: copy.ai.keyValid,
        });
      } else {
        setGeminiValid(false);
        addToast({
          type: "error",
          message: res.error || copy.ai.keyInvalid,
        });
      }
    } catch (err) {
      addToast({
        type: "error",
        message: `Validation error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setGeminiValidating(false);
    }
  };

  // Handle Timetable Image Upload
  const handleTimetableFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExtractingTimetable(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const extracted = await extractSchedule(base64);
          openModal({
            id: "schedule-preview",
            props: { extracted },
          });
        } catch (err) {
          addToast({
            type: "error",
            message: `Timetable vision extraction failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        } finally {
          setExtractingTimetable(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setExtractingTimetable(false);
    }
  };

  // Add course to step 3
  const handleAddCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    const course: Course = {
      id: newCode.trim().toUpperCase(),
      name: newName.trim(),
      color: newColor,
    };
    await upsertCourse(course, []);
    setNewCode("");
    setNewName("");
  };

  const [submittingFinish, setSubmittingFinish] = useState(false);

  // Finish Onboarding
  const handleFinish = async () => {
    setSubmittingFinish(true);
    try {
      await updateConfig({
        userName: userName.trim() || undefined,
        userEmail: userEmail.trim() || undefined,
        moodleUrl: moodleUrl.trim() || undefined,
        moodleIcalUrl: moodleIcalUrl.trim() || undefined,
        moodleEnabled: Boolean(moodleUrl.trim() || moodleIcalUrl.trim()),
        classroomEnabled,
        autoSyncGcal,
        onboardingCompleted: true,
      });

      // Run honest first scan
      await triggerSync();
      onClose();
    } catch (err) {
      addToast({
        type: "error",
        message: `Onboarding setup error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSubmittingFinish(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* v4 gradient header band */}
      <div className="flex shrink-0 items-start justify-between gap-3 bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-5 sm:px-6">
        <div>
          <h2
            id="onboarding-wizard-title"
            className="text-lg font-black leading-tight tracking-tight text-white sm:text-2xl"
          >
            {copy.onboarding.title}
          </h2>
          <p className="mt-0.5 text-xs text-blue-100/85">{copy.onboarding.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="-mr-1 -mt-1 shrink-0 rounded-xl p-2 text-white/90 transition hover:bg-white/15 active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Stepper — v4 numbered step tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-4 pt-3 sm:px-6">
        {[
          { id: 1, label: copy.onboarding.step1Title },
          { id: 2, label: copy.onboarding.step2Title },
          { id: 3, label: copy.onboarding.step3Title },
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id as 1 | 2 | 3)}
            aria-current={step === s.id ? "step" : undefined}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition ${
              step === s.id
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                step >= s.id
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "bg-[var(--surface-hover)] text-[var(--text-muted)]"
              }`}
            >
              {s.id}
            </span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {/* STEP 1: Profile, Track & Theme */}
        {step === 1 && (
          <div className="mt-6 space-y-6">
            {/* Coming from v4 card */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold text-[var(--text)]">
                    {copy.onboarding.comingFromV4Title}
                  </h4>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {copy.onboarding.comingFromV4Subtitle}
                  </p>
                </div>
                <label className="cursor-pointer shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-[var(--text)] hover:border-[var(--accent)] transition">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{copy.onboarding.importV4Action}</span>
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleImportV4File}
                  />
                </label>
              </div>
              {migrationSummary && (
                <div className="mt-3 p-2.5 rounded-lg bg-[var(--accent)]/10 text-xs text-[var(--text)] font-medium">
                  {migrationSummary}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  {copy.onboarding.nameLabel}
                </label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Student Name"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs font-medium text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  {copy.onboarding.emailLabel}
                </label>
                <input
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="student@university.edu"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs font-medium text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  {copy.onboarding.localProfileNote}
                </p>
              </div>
            </div>

            {/* Academic Rhythm Presets */}
            <div>
              <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                {copy.onboarding.tracksTitle}
              </label>
              <div className="grid grid-cols-1 gap-2.5">
                <button
                  type="button"
                  onClick={() => setSelectedTrack("med")}
                  className={`p-3 rounded-xl border text-left transition ${
                    selectedTrack === "med"
                      ? "border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--page)] hover:border-[var(--accent)]/40"
                  }`}
                >
                  <div className="text-xs font-bold text-[var(--text)]">
                    {copy.onboarding.trackMed}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {copy.onboarding.trackMedSub}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedTrack("eng")}
                  className={`p-3 rounded-xl border text-left transition ${
                    selectedTrack === "eng"
                      ? "border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--page)] hover:border-[var(--accent)]/40"
                  }`}
                >
                  <div className="text-xs font-bold text-[var(--text)]">
                    {copy.onboarding.trackEng}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {copy.onboarding.trackEngSub}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedTrack("biz")}
                  className={`p-3 rounded-xl border text-left transition ${
                    selectedTrack === "biz"
                      ? "border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--page)] hover:border-[var(--accent)]/40"
                  }`}
                >
                  <div className="text-xs font-bold text-[var(--text)]">
                    {copy.onboarding.trackBiz}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    {copy.onboarding.trackBizSub}
                  </div>
                </button>
              </div>
            </div>

            {/* Visual Theme Choice — v4 sun/moon tiles */}
            <div>
              <label className="mb-2 block text-xs font-bold text-[var(--text)]">
                Workspace Appearance
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  aria-pressed={theme === "light"}
                  className={`onboard-choice-card flex items-center gap-3 rounded-xl border p-3 text-left ${
                    theme === "light"
                      ? "is-selected border-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300">
                    <Sun className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[var(--text)]">
                      {copy.onboarding.themeLight}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Clean daylight timetable
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  aria-pressed={theme === "dark"}
                  className={`onboard-choice-card flex items-center gap-3 rounded-xl border p-3 text-left ${
                    theme === "dark"
                      ? "is-selected border-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-950 text-amber-300 dark:bg-indigo-950/70">
                    <Moon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[var(--text)]">
                      {copy.onboarding.themeDark}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Low-glare night study
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Connection Hub — v4 two-column account hubs */}
        {step === 2 && (
          <div className="onboard-step-panel space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Google Card */}
              <div className="flex flex-col justify-between space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--page)] p-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950/80">
                        <GoogleMark className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-[var(--text)]">
                          {copy.onboarding.googleConnect}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Google Calendar & Gemini AI
                        </div>
                      </div>
                    </div>
                    {auth.authenticated ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        {copy.onboarding.connectedBadge}
                      </span>
                    ) : (
                      <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-muted)]">
                        Not Connected
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                    Link your Gmail for automated assessment detection from course emails and
                    two-way Google Calendar synchronization.
                  </p>

                  {auth.authenticated ? (
                    <button
                      type="button"
                      onClick={googleLogout}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs font-bold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Disconnect Google</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={googleLogin}
                      className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-800 shadow-xs transition hover:bg-slate-50 active:scale-[0.99] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-750"
                    >
                      <GoogleMark className="h-4 w-4" />
                      <span>Sign in with Google</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Microsoft Card */}
              <div className="flex flex-col justify-between space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--page)] p-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-200 dark:bg-slate-800">
                        <MicrosoftMark className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-[var(--text)]">
                          {copy.onboarding.microsoftConnect}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          Teams, Outlook & Campus Feeds
                        </div>
                      </div>
                    </div>
                    {auth.hasTeamsAuth ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        {copy.onboarding.connectedBadge}
                      </span>
                    ) : (
                      <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-muted)]">
                        Not Connected
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                    Sign in to your university account for Teams channels and Outlook mail. Mail and
                    calendar permissions are requested separately, because many tenants require an
                    administrator to approve them.
                  </p>

                  {auth.hasTeamsAuth ? (
                    <button
                      type="button"
                      onClick={microsoftLogout}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs font-bold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Disconnect Microsoft</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={microsoftLogin}
                      className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#1e293b] px-3 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#0f172a] active:scale-[0.99]"
                    >
                      <MicrosoftMark className="h-4 w-4" />
                      <span>Sign in with Microsoft (Teams & 365)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Moodle LMS Card */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-3.5 space-y-2.5">
              <div className="text-xs font-bold text-[var(--text)]">
                {copy.onboarding.moodleConnect}
              </div>
              <input
                type="url"
                value={moodleUrl}
                onChange={(e) => setMoodleUrl(e.target.value)}
                placeholder={copy.onboarding.moodleUrlLabel}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none"
              />
              <input
                type="url"
                value={moodleIcalUrl}
                onChange={(e) => setMoodleIcalUrl(e.target.value)}
                placeholder={copy.onboarding.moodleIcalLabel}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none"
              />
            </div>

            {/* Gemini AI Card */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--text)]">
                  {copy.onboarding.geminiConnect}
                </span>
                {geminiValid ? (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                    Verified
                  </span>
                ) : (
                  <span className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold">
                    Optional
                  </span>
                )}
              </div>

              {/* Verbatim Disclosure */}
              <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-2.5 text-[11px] text-[var(--text)] space-y-0.5">
                <p>{copy.ai.disclosure}</p>
                <p className="font-semibold">{copy.ai.turnOff}</p>
              </div>

              <div className="flex gap-2">
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder={copy.ai.keyPlaceholder}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none"
                />
                <button
                  type="button"
                  disabled={geminiValidating || !geminiKey.trim()}
                  onClick={handleValidateGemini}
                  className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-purple-700 disabled:opacity-50"
                >
                  {geminiValidating ? "Checking…" : "Validate"}
                </button>
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">{copy.ai.quotaLimitNote}</div>
            </div>

            {/* Timetable Image Upload Card — desktop only. The browser tier
                has no vision-import command, so offering the upload there
                would promise something the tier cannot do. */}
            {isTauriEnvironment() ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--page)] p-4 text-center">
                <Upload className="h-6 w-6 text-[var(--accent)] mx-auto mb-2" />
                <div className="text-xs font-bold text-[var(--text)]">
                  {copy.onboarding.timetableUpload}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 mb-3">
                  {copy.onboarding.timetableUploadSub}
                </p>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)] transition">
                  <span>
                    {extractingTimetable
                      ? copy.onboarding.timetableExtracting
                      : copy.onboarding.timetableUploadButton}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={extractingTimetable}
                    onChange={handleTimetableFile}
                    className="hidden"
                  />
                </label>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--page)] p-4">
                <p className="text-[11px] text-[var(--text-muted)]">
                  {copy.onboarding.timetableUploadBrowserNote}
                </p>
              </div>
            )}

            {/* Consents-First Auto GCal */}
            <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer pt-2">
              <input
                type="checkbox"
                checked={autoSyncGcal}
                onChange={(e) => setAutoSyncGcal(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)]"
              />
              <span>{copy.onboarding.autoGcalLabel}</span>
            </label>
          </div>
        )}

        {/* STEP 3: Course Enrollment Grid & Finish */}
        {step === 3 && (
          <div className="mt-6 space-y-6">
            <form
              onSubmit={handleAddCourse}
              className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4 space-y-3"
            >
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Add Enrolled Course
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="Code (e.g. CSE241)"
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-bold text-[var(--text)] outline-none uppercase"
                />
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name (e.g. Logic Design)"
                  className="sm:col-span-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  {COURSE_PALETTE_PRESETS.slice(0, 6).map((presetColor: string) => (
                    <button
                      key={presetColor}
                      type="button"
                      onClick={() => setNewColor(presetColor)}
                      style={{ backgroundColor: presetColor }}
                      className={`h-5 w-5 rounded-md transition ${
                        newColor === presetColor ? "ring-2 ring-[var(--text)]" : "opacity-80"
                      }`}
                    />
                  ))}
                </div>
                <button
                  type="submit"
                  className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </form>

            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                Currently Enrolled ({courses.length})
              </div>
              {courses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--text-muted)]">
                  {copy.emptyStates.dashboardNoCourses}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {courses.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--page)] p-2.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                          style={{ backgroundColor: c.color || "var(--accent)" }}
                        >
                          {c.id.slice(0, 3)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[var(--text)] truncate">
                            {c.id}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate">
                            {c.name}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteCourse(c.id)}
                        className="p-1 text-[var(--text-muted)] hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Navigation Buttons — v4 footer bar */}
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-4 py-3 sm:px-6">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{copy.onboarding.back}</span>
          </button>
        ) : (
          <div />
        )}

        <span className="text-xs font-semibold tabular-nums text-[var(--text-muted)]">
          Step {step} of 3
        </span>

        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--accent-hover)] active:scale-[0.98]"
          >
            <span>{copy.onboarding.next}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={submittingFinish}
            onClick={handleFinish}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-blue-500/20 transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            <span>
              {submittingFinish ? copy.onboarding.finishSubmitting : copy.onboarding.finish}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
