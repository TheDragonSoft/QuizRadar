import { useState } from "react";
import { ArrowRight, ArrowLeft, Check, Upload, LogOut, X, Plus, Trash2 } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { COURSE_PALETTE_PRESETS } from "../lib/coursePalette";
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
  const openModal = useAppStore((s) => s.openModal);
  const addToast = useAppStore((s) => s.addToast);

  // Step 1: Profile & Rhythm State
  const [userName, setUserName] = useState(config.userName || auth.name || "");
  const [userEmail, setUserEmail] = useState(config.userEmail || auth.email || "");
  const [selectedTrack, setSelectedTrack] = useState<string>("eng");

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-wizard-title"
      className="relative w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all max-h-[92vh] overflow-y-auto"
    >
      {/* Top Header & Stepper */}
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <div>
          <h2
            id="onboarding-wizard-title"
            className="text-xl font-black tracking-tight text-[var(--text)]"
          >
            {copy.onboarding.title}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{copy.onboarding.subtitle}</p>
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

      {/* Stepper Progress Bar */}
      <div className="mt-4 flex items-center justify-between gap-2 text-xs font-semibold">
        <div
          className={`flex-1 flex items-center gap-2 pb-2 border-b-2 transition ${
            step >= 1
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[11px]">
            1
          </span>
          <span>{copy.onboarding.step1Title}</span>
        </div>
        <div
          className={`flex-1 flex items-center gap-2 pb-2 border-b-2 transition ${
            step >= 2
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[11px]">
            2
          </span>
          <span>{copy.onboarding.step2Title}</span>
        </div>
        <div
          className={`flex-1 flex items-center gap-2 pb-2 border-b-2 transition ${
            step >= 3
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[11px]">
            3
          </span>
          <span>{copy.onboarding.step3Title}</span>
        </div>
      </div>

      {/* STEP 1: Profile, Track & Theme */}
      {step === 1 && (
        <div className="mt-6 space-y-6">
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

          {/* Visual Theme Choice */}
          <div>
            <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
              {copy.onboarding.themeTitle}
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition ${
                  theme === "light"
                    ? "border-[var(--accent)] bg-[var(--surface)] text-[var(--accent)] shadow-sm"
                    : "border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                Light Theme
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition ${
                  theme === "dark"
                    ? "border-[var(--accent)] bg-[var(--surface)] text-[var(--accent)] shadow-sm"
                    : "border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                Dark Theme
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Connection Hub */}
      {step === 2 && (
        <div className="mt-6 space-y-4">
          {/* Google Card */}
          <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--page)] p-3.5">
            <div>
              <div className="text-xs font-bold text-[var(--text)]">
                {copy.onboarding.googleConnect}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Scan announcement emails and calendar sync
              </div>
            </div>
            <div>
              {auth.authenticated ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    {copy.onboarding.connectedBadge}
                  </span>
                  <button
                    type="button"
                    onClick={googleLogout}
                    className="p-1 text-[var(--text-muted)] hover:text-red-500"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={googleLogin}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)]"
                >
                  Connect
                </button>
              )}
            </div>
          </div>

          {/* Microsoft Teams Card */}
          <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--page)] p-3.5">
            <div>
              <div className="text-xs font-bold text-[var(--text)]">
                {copy.onboarding.microsoftConnect}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Scan class teams, channels & assignments
              </div>
            </div>
            <div>
              {auth.hasTeamsAuth ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    {copy.onboarding.connectedBadge}
                  </span>
                  <button
                    type="button"
                    onClick={microsoftLogout}
                    className="p-1 text-[var(--text-muted)] hover:text-red-500"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={microsoftLogin}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30"
                >
                  Connect
                </button>
              )}
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
            <div className="text-[10px] text-[var(--text-muted)]">
              Quota: ~250 req/day (flash) / ~1,000 req/day (flash-lite); resets midnight PT
            </div>
          </div>

          {/* Timetable Image Upload Card */}
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
                        <div className="text-xs font-bold text-[var(--text)] truncate">{c.id}</div>
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

      {/* Navigation Buttons */}
      <div className="mt-8 flex items-center justify-between border-t border-[var(--border)] pt-4">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{copy.onboarding.back}</span>
          </button>
        ) : (
          <div />
        )}

        {step < 3 ? (
          <button
            type="button"
            onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)] transition"
          >
            <span>{copy.onboarding.next}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={submittingFinish}
            onClick={handleFinish}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-blue-500/20 hover:bg-[var(--accent-hover)] transition disabled:opacity-50"
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
