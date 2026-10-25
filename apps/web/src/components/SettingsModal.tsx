import { useState } from "react";
import {
  User,
  BookOpen,
  Sliders,
  LogIn,
  LogOut,
  Plus,
  Trash2,
  Edit2,
  Calendar,
  Upload,
  Download,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  X,
} from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import type { Course, FeedConfig } from "../state/types";

const SETTINGS_TAB_KEY = "quizradar_settings_tab";

export function SettingsModal({
  props,
  onClose,
}: {
  modalId: string;
  props?: Record<string, unknown>;
  onClose: () => void;
}) {
  type Tab = "account" | "courses" | "integrations";
  const initialTab =
    (props?.initialTab as Tab) ||
    (typeof window !== "undefined" && (localStorage.getItem(SETTINGS_TAB_KEY) as Tab)) ||
    "account";

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(SETTINGS_TAB_KEY, tab);
    } catch {
      // ignore
    }
  };

  const auth = useAppStore((s) => s.data.auth);
  const config = useAppStore((s) => s.data.config);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const slots = useAppStore((s) => s.data.schedule.slots);
  const feeds = useAppStore((s) => s.data.config.feeds || []);

  const updateConfig = useAppStore((s) => s.updateConfig);
  const deleteCourse = useAppStore((s) => s.deleteCourse);
  const upsertFeed = useAppStore((s) => s.upsertFeed);
  const deleteFeed = useAppStore((s) => s.deleteFeed);
  const runGcalSync = useAppStore((s) => s.runGcalSync);
  const googleLogin = useAppStore((s) => s.googleLogin);
  const googleLogout = useAppStore((s) => s.googleLogout);
  const microsoftLogin = useAppStore((s) => s.microsoftLogin);
  const microsoftLogout = useAppStore((s) => s.microsoftLogout);
  const validateGeminiKey = useAppStore((s) => s.validateGeminiKey);
  const checkUpdate = useAppStore((s) => s.checkUpdate);
  const exportBackupFile = useAppStore((s) => s.exportBackupFile);
  const importBackupFile = useAppStore((s) => s.importBackupFile);
  const resetDatabase = useAppStore((s) => s.resetDatabase);
  const openModal = useAppStore((s) => s.openModal);
  const addToast = useAppStore((s) => s.addToast);

  // BYOK Gemini state
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [validatingKey, setValidatingKey] = useState(false);
  const [geminiValidationResult, setGeminiValidationResult] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);

  // Moodle state
  const [moodleUrl, setMoodleUrl] = useState(config.moodleUrl || "");
  const [moodleIcalUrl, setMoodleIcalUrl] = useState(config.moodleIcalUrl || "");

  // Feed add state
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");

  // Update check state
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  const handleValidateGemini = async () => {
    if (!geminiKeyInput.trim()) return;
    setValidatingKey(true);
    setGeminiValidationResult(null);
    try {
      const res = await validateGeminiKey(geminiKeyInput.trim());
      setGeminiValidationResult(res);
      if (res.valid) {
        await updateConfig({ geminiEnabled: true });
        addToast({
          type: "success",
          message: copy.ai.keyValid,
        });
      } else {
        addToast({
          type: "error",
          message: res.error || copy.ai.keyInvalid,
        });
      }
    } catch (err) {
      setGeminiValidationResult({
        valid: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setValidatingKey(false);
    }
  };

  const handleToggleGemini = async () => {
    await updateConfig({ geminiEnabled: !config.geminiEnabled });
  };

  const handleSaveMoodle = async () => {
    await updateConfig({
      moodleUrl: moodleUrl.trim() || undefined,
      moodleIcalUrl: moodleIcalUrl.trim() || undefined,
      moodleEnabled: Boolean(moodleUrl.trim() || moodleIcalUrl.trim()),
    });
    addToast({
      type: "success",
      message: "Moodle configuration saved",
    });
  };

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = newFeedUrl.trim();
    const trimmedName = newFeedName.trim();
    if (!trimmedUrl.startsWith("https://")) {
      addToast({
        type: "error",
        message: copy.settings.feedHttpsError,
      });
      return;
    }
    const newFeed: FeedConfig = {
      id: `feed-${Date.now()}`,
      name: trimmedName || "External Calendar",
      url: trimmedUrl,
      enabled: true,
    };
    await upsertFeed(newFeed);
    setNewFeedName("");
    setNewFeedUrl("");
  };

  const handleDeleteCourse = (c: Course) => {
    openModal({
      id: "app-confirm",
      props: {
        title: `Delete Course ${c.id}?`,
        message: `This will remove course ${c.id} (${c.name}) and all its associated weekly timetable slots.`,
        destructive: true,
        confirmLabel: "Delete Course",
        onConfirm: async () => {
          await deleteCourse(c.id);
        },
      },
    });
  };

  const handleResetData = () => {
    openModal({
      id: "app-confirm",
      props: {
        title: "Reset All Local Data?",
        message: copy.settings.resetDatabaseWarn,
        destructive: true,
        confirmLabel: "Reset Everything",
        onConfirm: () => {
          // Double-confirm
          openModal({
            id: "app-confirm",
            props: {
              title: "Are you absolutely sure?",
              message:
                "All courses, timetable slots, assessments, and cached items will be permanently erased. This cannot be undone.",
              destructive: true,
              confirmLabel: "Yes, Permanently Delete",
              onConfirm: async () => {
                await resetDatabase();
                onClose();
                addToast({
                  type: "info",
                  message: "All application data reset. Fresh database initialized.",
                });
              },
            },
          });
        },
      },
    });
  };

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    setUpdateResult(null);
    try {
      const res = await checkUpdate();
      if (res.available) {
        setUpdateResult(`Update available: v${res.latestVersion}`);
      } else if (res.error) {
        setUpdateResult(res.error);
      } else {
        setUpdateResult(`QuizRadar is up to date (v${res.currentVersion}).`);
      }
    } catch (err) {
      setUpdateResult(`Update check error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdateChecking(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="relative w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl transition-all max-h-[90vh] overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
        <div>
          <h2 id="settings-modal-title" className="text-xl font-bold text-[var(--text)]">
            {copy.settings.title}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Manage your account connections, courses, integrations, and local storage.
          </p>
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

      {/* Tabs Switcher */}
      <div className="mt-4 flex rounded-xl border border-[var(--border)] bg-[var(--page)] p-1">
        <button
          type="button"
          onClick={() => handleTabChange("account")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${
            activeTab === "account"
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <User className="h-4 w-4" />
          <span>{copy.settings.tabAccount}</span>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("courses")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${
            activeTab === "courses"
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <BookOpen className="h-4 w-4" />
          <span>{copy.settings.tabCourses}</span>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("integrations")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${
            activeTab === "integrations"
              ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          <Sliders className="h-4 w-4" />
          <span>{copy.settings.tabIntegrations}</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {/* ================= ACCOUNT TAB ================= */}
        {activeTab === "account" && (
          <div className="space-y-6">
            {/* Identity Profile Card */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                {copy.settings.accountHeader}
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-[var(--text)]">
                    {auth.name || config.userName || "Student User"}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {auth.email || config.userEmail || copy.settings.notSignedIn}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {auth.authenticated ? (
                    <button
                      type="button"
                      onClick={googleLogout}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>{copy.settings.disconnect}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={googleLogin}
                      className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)]"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      <span>Sign in with Google</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Microsoft Teams Authentication Card */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                Microsoft Teams & Education
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[var(--text)]">
                    Microsoft Graph Connection
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {auth.hasTeamsAuth
                      ? "Connected via Microsoft PKCE OAuth"
                      : "Not connected to Microsoft Teams"}
                  </div>
                </div>
                <div>
                  {auth.hasTeamsAuth ? (
                    <button
                      type="button"
                      onClick={microsoftLogout}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Disconnect Teams</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={microsoftLogin}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      <span>Connect Teams</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* BYOK Gemini AI Configuration Card */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Google Gemini AI (Bring Your Own Key)
                  </h3>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs font-semibold text-[var(--text)]">
                    {config.geminiEnabled ? "AI Enabled" : "AI Disabled"}
                  </span>
                  <input
                    type="checkbox"
                    checked={config.geminiEnabled}
                    onChange={handleToggleGemini}
                    className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)]"
                  />
                </label>
              </div>

              {/* Exact Verbatim Disclosure Copy */}
              <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-3 text-xs text-[var(--text)] space-y-1">
                <p>{copy.ai.disclosure}</p>
                <p className="font-semibold">{copy.ai.turnOff}</p>
              </div>

              <div className="mt-4 flex gap-2">
                <input
                  type="password"
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  placeholder={copy.ai.keyPlaceholder}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-purple-500"
                />
                <button
                  type="button"
                  disabled={validatingKey || !geminiKeyInput.trim()}
                  onClick={handleValidateGemini}
                  className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-purple-700 transition disabled:opacity-50"
                >
                  {validatingKey ? "Validating…" : copy.ai.validateButton}
                </button>
              </div>

              {geminiValidationResult && (
                <div
                  className={`mt-2 text-xs font-semibold ${
                    geminiValidationResult.valid
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {geminiValidationResult.valid
                    ? copy.ai.keyValid
                    : geminiValidationResult.error || copy.ai.keyInvalid}
                </div>
              )}

              <div className="mt-3 flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
                <div className="flex items-center justify-between">
                  <span>{copy.ai.quotaText(0)}</span>
                  <span>{copy.ai.quotaCapNote}</span>
                </div>
                <div className="text-[10px]">
                  Quota: ~250 req/day (flash) / ~1,000 req/day (flash-lite); resets midnight PT
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= COURSES TAB ================= */}
        {activeTab === "courses" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {copy.settings.coursesHeader}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {courses.length} course{courses.length === 1 ? "" : "s"} enrolled
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openModal({ id: "onboarding" })}
                  className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
                >
                  {copy.settings.reopenOnboarding}
                </button>
                <button
                  type="button"
                  onClick={() => openModal({ id: "add-course" })}
                  className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)] transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{copy.settings.addCourse}</span>
                </button>
              </div>
            </div>

            {courses.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">
                {copy.sidebar.noCoursesEnrolled}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {courses.map((c) => {
                  const courseSlots = slots.filter(
                    (s) => s.courseId.toLowerCase() === c.id.toLowerCase(),
                  );
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--page)] p-3.5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm"
                          style={{ backgroundColor: c.color || "var(--accent)" }}
                        >
                          {c.id.slice(0, 3)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[var(--text)] truncate">
                            {c.id}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {c.name}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                            {courseSlots.length} weekly slot{courseSlots.length === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openModal({ id: "add-course", props: { course: c } })}
                          aria-label={`Edit course ${c.id}`}
                          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--border)]/30 hover:text-[var(--text)]"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCourse(c)}
                          aria-label={`Delete course ${c.id}`}
                          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================= INTEGRATIONS TAB ================= */}
        {activeTab === "integrations" && (
          <div className="space-y-6">
            {/* Google Calendar Section */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    {copy.settings.integrationsHeader}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={runGcalSync}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
                >
                  {copy.settings.gcalPushNow}
                </button>
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between text-xs font-semibold text-[var(--text)] cursor-pointer">
                  <span>{copy.settings.gcalAutoPush}</span>
                  <input
                    type="checkbox"
                    checked={config.autoSyncGcal}
                    onChange={(e) => updateConfig({ autoSyncGcal: e.target.checked })}
                    className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)]"
                  />
                </label>

                <label className="flex items-center justify-between text-xs font-semibold text-[var(--text)] cursor-pointer">
                  <span>{copy.settings.gcalClassesPush}</span>
                  <input
                    type="checkbox"
                    checked={config.syncWeeklyClassesToGcal}
                    onChange={(e) => updateConfig({ syncWeeklyClassesToGcal: e.target.checked })}
                    className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)]"
                  />
                </label>
              </div>
            </div>

            {/* Moodle LMS Section */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Moodle LMS Integration
                </h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs font-semibold text-[var(--text)]">Enabled</span>
                  <input
                    type="checkbox"
                    checked={config.moodleEnabled}
                    onChange={(e) => updateConfig({ moodleEnabled: e.target.checked })}
                    className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)]"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    {copy.onboarding.moodleUrlLabel}
                  </label>
                  <input
                    type="url"
                    value={moodleUrl}
                    onChange={(e) => setMoodleUrl(e.target.value)}
                    placeholder="https://moodle.university.edu"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    {copy.onboarding.moodleIcalLabel}
                  </label>
                  <input
                    type="url"
                    value={moodleIcalUrl}
                    onChange={(e) => setMoodleIcalUrl(e.target.value)}
                    placeholder="https://moodle.university.edu/calendar/export_execute.php?..."
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveMoodle}
                    className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
                  >
                    Save Moodle URLs
                  </button>
                </div>
              </div>
            </div>

            {/* Notification Preferences Section */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                {copy.settings.notificationPrefsTitle}
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                {copy.settings.notificationPrefsNote}
              </p>
            </div>

            {/* External ICS Feeds Section */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                {copy.settings.feedsTitle}
              </h3>

              <form onSubmit={handleAddFeed} className="flex gap-2 mb-4">
                <input
                  type="text"
                  required
                  value={newFeedName}
                  onChange={(e) => setNewFeedName(e.target.value)}
                  placeholder={copy.settings.feedNamePlaceholder}
                  className="w-1/3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none"
                />
                <input
                  type="url"
                  required
                  value={newFeedUrl}
                  onChange={(e) => setNewFeedUrl(e.target.value)}
                  placeholder={copy.settings.feedUrlPlaceholder}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)] transition shrink-0"
                >
                  {copy.settings.addFeed}
                </button>
              </form>

              {feeds.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)] italic">
                  {copy.settings.noFeeds}
                </div>
              ) : (
                <div className="space-y-2">
                  {feeds.map((feed) => (
                    <div
                      key={feed.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[var(--text)] truncate">
                          {feed.name}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          {feed.url}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteFeed(feed.id)}
                        className="p-1 text-[var(--text-muted)] hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Backup, Restore & Reset Section */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                {copy.settings.backupHeader}
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => exportBackupFile()}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
                >
                  <Download className="h-4 w-4" />
                  <span>{copy.settings.exportBackup}</span>
                </button>

                <button
                  type="button"
                  onClick={() => importBackupFile()}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition"
                >
                  <Upload className="h-4 w-4" />
                  <span>{copy.settings.importBackup}</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetData}
                  className="flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 transition"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>{copy.settings.resetDatabase}</span>
                </button>
              </div>
            </div>

            {/* Software Updates Section */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    {copy.settings.updaterHeader}
                  </h3>
                  <div className="text-xs text-[var(--text-muted)] mt-0.5">
                    {updateResult || "Current release: v5.0.0-alpha.1"}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={updateChecking}
                  onClick={handleCheckUpdate}
                  className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--border)]/30 transition disabled:opacity-50"
                >
                  {updateChecking ? "Checking…" : copy.settings.checkUpdates}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-between border-t border-[var(--border)] pt-4">
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          <span>Local Storage · Zero Server Logs</span>
        </div>
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
