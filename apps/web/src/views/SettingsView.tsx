import { useEffect, useRef, useState } from "react";
import {
  User,
  BookOpen,
  Sliders,
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
  ChevronRight,
} from "lucide-react";
import { copy } from "../copy";
import { courseAccessibleChip } from "../lib/coursePalette";
import { useAppStore } from "../state/store";
import { isTauriEnvironment } from "../state/rpc";
import { APP_VERSION } from "../generated/version";
import { GoogleMark, MicrosoftMark } from "../components/BrandMarks";
import type { Course, FeedConfig, SettingsSection } from "../state/types";

/**
 * Settings as a full-screen page (the old three-tab modal, promoted: one
 * scrollable surface with an anchored side rail on wide screens). Every
 * handler is the modal's, verbatim — only the chrome changed. Sections
 * anchor-link so `openSettings("courses")`-style callers land exactly where
 * the task they came for lives.
 */

const SECTION_ID: Record<SettingsSection, string> = {
  account: "settings-section-account",
  courses: "settings-section-courses",
  integrations: "settings-section-integrations",
};

export function SettingsView() {
  const theme = useAppStore((s) => s.theme);
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
  const microsoftGrantScanningAccess = useAppStore((s) => s.microsoftGrantScanningAccess);
  const microsoftLogout = useAppStore((s) => s.microsoftLogout);
  const validateGeminiKey = useAppStore((s) => s.validateGeminiKey);
  const extractSchedule = useAppStore((s) => s.extractSchedule);
  const aiQuota = useAppStore((s) => s.aiQuota);
  const refreshAiQuota = useAppStore((s) => s.refreshAiQuota);
  const checkUpdate = useAppStore((s) => s.checkUpdate);
  const exportBackupFile = useAppStore((s) => s.exportBackupFile);
  const importBackupFile = useAppStore((s) => s.importBackupFile);
  const resetDatabase = useAppStore((s) => s.resetDatabase);
  const openModal = useAppStore((s) => s.openModal);
  const addToast = useAppStore((s) => s.addToast);
  const pendingSettingsSection = useAppStore((s) => s.pendingSettingsSection);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  // A caller that asked for a specific section scrolls the page there, then
  // the request is consumed (jsdom has no scrollIntoView — guard it).
  useEffect(() => {
    if (!pendingSettingsSection) return;
    const element = document.getElementById(SECTION_ID[pendingSettingsSection]);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    useAppStore.setState({ pendingSettingsSection: null });
  }, [pendingSettingsSection]);

  // The academic rhythm preset (`01` §4.1) is persisted — the onboarding
  // answer is kept, shown here, and changeable without re-running the
  // wizard.
  const TRACK_OPTIONS = [
    { id: "med", label: copy.onboarding.trackMed },
    { id: "eng", label: copy.onboarding.trackEng },
    { id: "biz", label: copy.onboarding.trackBiz },
  ] as const;
  const savedTrack = TRACK_OPTIONS.find((track) => track.id === config.academicTrack);
  const savedTrackLabel = savedTrack
    ? savedTrack.label
    : config.academicTrack
      ? `${config.academicTrack} — ${copy.onboarding.trackUnknown}`
      : copy.onboarding.trackNotSet;

  const handleTrackChange = async (track: string) => {
    try {
      await updateConfig({ academicTrack: track });
      addToast({ type: "success", message: copy.onboarding.trackSaved });
    } catch {
      // The store already toasted the real failure reason.
    }
  };

  const handleBrowserImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const jsonText = await file.text();
      const report = await importBackupFile(undefined, jsonText);
      // A quiet import contradicts the honesty doctrine — surface the real
      // counts and any partial-failure warnings, like the backup modal does.
      addToast({
        type: "success",
        message: `Imported ${report.coursesImported} courses, ${report.assessmentsImported} assessments, ${report.topicsImported} topics`,
      });
      for (const warning of report.warnings) {
        addToast({ type: "warning", message: warning });
      }
    } catch (err) {
      addToast({
        type: "error",
        message: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // BYOK Gemini state
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [validatingKey, setValidatingKey] = useState(false);
  const [geminiValidationResult, setGeminiValidationResult] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);

  // Timetable vision import state
  const [extractingTimetable, setExtractingTimetable] = useState(false);

  // Moodle state
  const [moodleUrl, setMoodleUrl] = useState(config.moodleUrl || "");
  const [moodleIcalUrl, setMoodleIcalUrl] = useState(config.moodleIcalUrl || "");

  // Browser-tier OAuth client IDs (GIS / MS PKCE popup)
  const isBrowserTier = !isTauriEnvironment();

  // Feed add state
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");

  // The AI usage line reads the device's real ledger, not a fixed number.
  useEffect(() => {
    void refreshAiQuota();
  }, [refreshAiQuota]);

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
      // The validation ping is a real provider call — the counter moves.
      await refreshAiQuota();
      if (res.valid) {
        await updateConfig({ geminiEnabled: true });
        addToast({
          type: "success",
          message: isBrowserTier ? copy.ai.keyValidMemory : copy.ai.keyValid,
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

  // Timetable vision import (`01` §4.1): pick an image → Gemini Vision reads
  // the courses and slots → the preview modal shows exactly what was read
  // before anything is saved. The manual course editor stays one click away
  // for every image the model cannot read.
  const handleTimetableImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setExtractingTimetable(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("The image could not be read from disk."));
        reader.readAsDataURL(file);
      });
      const extracted = await extractSchedule(dataUrl);
      openModal({ id: "schedule-preview", props: { extracted } });
    } catch (err) {
      addToast({
        type: "error",
        message: `Timetable extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExtractingTimetable(false);
    }
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
                // resetDatabase toasts its own failure; only claim success
                // when the wipe actually happened. (The page stays — the
                // freshly emptied state is honest evidence enough.)
                const wiped = await resetDatabase();
                if (!wiped) return;
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

  const scrollToSection = (section: SettingsSection) => {
    document
      .getElementById(SECTION_ID[section])
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div data-testid="view-settings" className="mx-auto flex w-full max-w-6xl gap-10">
      {/* Side rail (wide screens): anchored section navigation */}
      <nav
        aria-label="Settings sections"
        className="sticky top-6 hidden h-fit w-56 shrink-0 lg:block"
      >
        <div className="flex items-center gap-2.5 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <Sliders className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold text-[var(--text)]">{copy.settings.title}</h1>
        </div>
        <ul className="space-y-1 border-t border-[var(--border)] pt-3">
          {(
            [
              { id: "account", label: copy.settings.tabAccount, Icon: User },
              { id: "courses", label: copy.settings.tabCourses, Icon: BookOpen },
              { id: "integrations", label: copy.settings.tabIntegrations, Icon: Sliders },
            ] as const
          ).map(({ id, label, Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => scrollToSection(id)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-[var(--border)] px-3 pt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {copy.settings.pageSubtitle}
        </p>
      </nav>

      {/* Scrollable page body */}
      <div className="min-w-0 flex-1 space-y-10 pb-16">
        {/* Mobile header (the rail carries the title on lg+) */}
        <div className="lg:hidden">
          <h1 className="text-lg font-bold text-[var(--text)]">{copy.settings.title}</h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{copy.settings.pageSubtitle}</p>
          <div className="mt-3 flex gap-1.5 overflow-x-auto">
            {(
              [
                { id: "account", label: copy.settings.tabAccount },
                { id: "courses", label: copy.settings.tabCourses },
                { id: "integrations", label: copy.settings.tabIntegrations },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollToSection(id)}
                className="shrink-0 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ================= ACCOUNT ================= */}
        <section id={SECTION_ID.account} className="scroll-mt-6 space-y-5">
          <div className="border-b border-[var(--border)] pb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
              <User className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
              {copy.settings.tabAccount}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {copy.settings.sectionAccountSub}
            </p>
          </div>

          {/* Identity banner — v4 profile card, opens the account manager */}
          <button
            type="button"
            onClick={() => openModal({ id: "account-profile" })}
            className="interactive-card flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--page)] p-4 text-left"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-700 to-indigo-800 text-sm font-bold text-white shadow-sm">
                {(auth.name || config.userName || "S").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-[var(--text)]">
                  {auth.name || config.userName || "Student"}
                </div>
                <div className="truncate text-[11px] text-[var(--text-muted)]">
                  {auth.email || config.userEmail || copy.settings.notSignedIn}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--accent-ink)]">
              <span>Manage Accounts</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </div>
          </button>

          {/* Academic rhythm preset — persisted (`01` §4.1) and now WIRED:
              it tunes the roadmap's prep-day spread (see the disclosure). */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <div className="text-xs font-bold text-[var(--text)]">
              {copy.onboarding.tracksTitle}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{savedTrackLabel}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {TRACK_OPTIONS.map((track) => {
                const active = config.academicTrack === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => void handleTrackChange(track.id)}
                    className={`rounded-lg border px-3 py-2 text-left text-[11px] font-semibold transition ${
                      active
                        ? "border-[var(--accent-ink)] bg-[var(--accent-ink)]/10 text-[var(--accent-ink)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    {track.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2.5 text-[11px] text-[var(--text-muted)]">
              {copy.onboarding.trackEffect}
            </p>
          </div>

          {/* Google account — v4 hub card with the real Google mark */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950/80">
                  <GoogleMark className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[var(--text)]">
                    Personal Google Account
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Gmail scanning, Calendar push & Drive backup
                  </div>
                </div>
              </div>
              {auth.authenticated ? (
                <button
                  type="button"
                  onClick={googleLogout}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{copy.settings.disconnect}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={googleLogin}
                  className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-xs transition hover:bg-slate-50 active:scale-[0.99] dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-750"
                >
                  <GoogleMark className="h-4 w-4" />
                  <span>Sign in with Google</span>
                </button>
              )}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
              {auth.authenticated
                ? `Connected${auth.email ? ` as ${auth.email}` : ""}. Tokens stay in the OS keyring (desktop) or in memory for one hour (web).`
                : isBrowserTier
                  ? copy.settings.browserSignInNote
                  : "Signs in with the bundled Google client (ID + secret, kept inside the app) over PKCE."}
            </p>
            {!isBrowserTier && !auth.authenticated && !config.googleClientId && (
              <p className="mt-2 rounded-lg border border-slate-300/60 bg-slate-500/10 px-3 py-2 text-[11px] font-semibold text-[var(--text)]">
                Using the bundled Google client (project quizradar-511922).
              </p>
            )}
          </div>

          {/* Microsoft Teams account — v4 university hub card */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-200 dark:bg-slate-800">
                  <MicrosoftMark className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[var(--text)]">
                    University Account (Microsoft 365)
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Teams, Outlook & campus feeds
                  </div>
                </div>
              </div>
              {auth.hasTeamsAuth ? (
                <button
                  type="button"
                  onClick={microsoftLogout}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Disconnect</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={microsoftLogin}
                  className="flex shrink-0 items-center gap-2 rounded-xl bg-[#1e293b] px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#0f172a] active:scale-[0.99]"
                >
                  <MicrosoftMark className="h-4 w-4" />
                  <span>Sign in with Microsoft</span>
                </button>
              )}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
              {auth.hasTeamsAuth
                ? `Connected${config.teamsAccountEmail ? ` as ${config.teamsAccountEmail}` : ""}.`
                : "Sign-in asks only for your identity. Mail and calendar scanning are a separate step, because many university tenants require an administrator to approve those permissions."}
            </p>
            {auth.hasTeamsAuth && (
              <button
                type="button"
                onClick={microsoftGrantScanningAccess}
                className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
              >
                <ShieldCheck className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
                <span>Grant mail & calendar access</span>
              </button>
            )}
          </div>

          {/* BYOK Gemini AI Configuration Card */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles
                  className="h-4 w-4 text-purple-600 dark:text-purple-400"
                  aria-hidden="true"
                />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Google Gemini AI (Bring Your Own Key)
                </h3>
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text)]">
                  {config.geminiEnabled ? "AI Enabled" : "AI Disabled"}
                </span>
                <input
                  type="checkbox"
                  checked={config.geminiEnabled}
                  onChange={handleToggleGemini}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                />
              </label>
            </div>

            {/* Exact Verbatim Disclosure Copy */}
            <div className="space-y-1 rounded-lg border border-purple-500/20 bg-purple-500/10 p-3 text-xs text-[var(--text)]">
              <p>{copy.ai.disclosure}</p>
              <p className="font-semibold">{copy.ai.turnOff}</p>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                type="password"
                aria-label="Gemini API key"
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                placeholder={copy.ai.keyPlaceholder}
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-purple-600"
              />
              <button
                type="button"
                disabled={validatingKey || !geminiKeyInput.trim()}
                onClick={handleValidateGemini}
                className="rounded-xl bg-purple-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-purple-800 disabled:opacity-50"
              >
                {validatingKey ? "Validating…" : copy.ai.validateButton}
              </button>
            </div>

            {!isBrowserTier && (
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">{copy.ai.sharedKeyHint}</p>
            )}

            {geminiValidationResult && (
              <div
                className={`mt-2 text-xs font-semibold ${
                  geminiValidationResult.valid
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-red-700 dark:text-red-300"
                }`}
              >
                {geminiValidationResult.valid
                  ? isBrowserTier
                    ? copy.ai.keyValidMemory
                    : copy.ai.keyValid
                  : geminiValidationResult.error || copy.ai.keyInvalid}
              </div>
            )}

            <div className="mt-3 flex flex-col gap-1 text-[11px] tabular-nums text-[var(--text-muted)]">
              <div className="flex items-center justify-between">
                <span>
                  {aiQuota?.sessionScope
                    ? copy.ai.quotaTextSession(aiQuota.callsToday ?? 0)
                    : copy.ai.quotaText(aiQuota?.callsToday ?? null)}
                </span>
                <span>{copy.ai.quotaCapNote}</span>
              </div>
              <div className="text-[11px]">{copy.ai.quotaLimitNote}</div>
            </div>
          </div>
        </section>

        {/* ================= COURSES ================= */}
        <section id={SECTION_ID.courses} className="scroll-mt-6 space-y-6">
          <div className="border-b border-[var(--border)] pb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
              <BookOpen className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
              {copy.settings.tabCourses}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {copy.settings.sectionCoursesSub}
            </p>
          </div>

          {/* Timetable vision import (`01` §4.1): image → Gemini Vision →
              preview → apply. The manual editor is always one click away. */}
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--page)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
                <Upload className="h-4.5 w-4.5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-xs font-bold text-[var(--text)]">
                  {copy.settings.timetableImportTitle}
                </h4>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  {copy.settings.timetableImportSub}
                </p>
                {(!config.geminiEnabled || aiQuota?.keyInMemory === false) && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                    {copy.settings.timetableImportNoKey}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--accent-fill-hover)]">
                    <span>
                      {extractingTimetable
                        ? copy.settings.timetableImportExtracting
                        : copy.settings.timetableImportButton}
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-label={copy.settings.timetableImportButton}
                      disabled={extractingTimetable}
                      onChange={handleTimetableImage}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => openModal({ id: "add-course" })}
                    className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
                  >
                    {copy.settings.timetableImportManual}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {copy.settings.coursesHeader}
              </h3>
              <p className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">
                {courses.length} course{courses.length === 1 ? "" : "s"} enrolled
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openModal({ id: "onboarding", flush: true })}
                className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
              >
                {copy.settings.reopenOnboarding}
              </button>
              <button
                type="button"
                onClick={() => openModal({ id: "add-course" })}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--accent-fill-hover)]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{copy.settings.addCourse}</span>
              </button>
            </div>
          </div>

          {courses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">
              {copy.sidebar.noCoursesEnrolled}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {courses.map((c) => {
                const courseSlots = slots.filter(
                  (s) => s.courseId.toLowerCase() === c.id.toLowerCase(),
                );
                const chip = courseAccessibleChip(c.color || "#1a73e8", theme === "dark");
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--page)] p-3.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm"
                        style={{ backgroundColor: chip.solidBg }}
                      >
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-[var(--text)]">
                          {c.name}
                        </div>
                        <div className="truncate text-[11px] text-[var(--text-muted)]">{c.id}</div>
                        <div className="mt-0.5 text-[11px] tabular-nums text-[var(--text-muted)]">
                          {courseSlots.length} weekly slot
                          {courseSlots.length === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>

                    <div className="ml-2 flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openModal({ id: "add-course", props: { course: c } })}
                        aria-label={`Edit course ${c.id}`}
                        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] hover:text-[var(--text)]"
                      >
                        <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCourse(c)}
                        aria-label={`Delete course ${c.id}`}
                        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ================= INTEGRATIONS ================= */}
        <section id={SECTION_ID.integrations} className="scroll-mt-6 space-y-6">
          <div className="border-b border-[var(--border)] pb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
              <Sliders className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
              {copy.settings.tabIntegrations}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {copy.settings.sectionIntegrationsSub}
            </p>
          </div>

          {/* Google Calendar Section */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {copy.settings.integrationsHeader}
                </h3>
              </div>
              <button
                type="button"
                onClick={runGcalSync}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
              >
                {copy.settings.gcalPushNow}
              </button>
            </div>

            <div className="space-y-3">
              <label className="flex cursor-pointer items-center justify-between text-xs font-semibold text-[var(--text)]">
                <span>{copy.settings.gcalAutoPush}</span>
                <input
                  type="checkbox"
                  checked={config.autoSyncGcal}
                  onChange={(e) => updateConfig({ autoSyncGcal: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                />
              </label>
              <p className="text-[11px] text-[var(--text-muted)]">
                Pushes the fresh radar to Google Calendar after every scan that found something. A
                scan that fetched nothing, or a Calendar scope refusal, is reported in the scan
                notes — never silently skipped.
              </p>
            </div>
          </div>

          {/* University Sources Section — spec `01` §4.9: each source is
              a user control. Gmail follows the Google account itself; the
              Teams and Classroom toggles exclude one source from scans
              without disconnecting the account. */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              University Sources
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text)]">
                  Microsoft Teams
                  <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                    {config.teamsAccountName ? "connected" : "not connected"}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={config.teamsEnabled}
                  onChange={(e) => updateConfig({ teamsEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text)]">
                  Google Classroom
                  <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                    follows the Google account
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={config.classroomEnabled}
                  onChange={(e) => updateConfig({ classroomEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                />
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Gmail scans run whenever the Google account is connected. These toggles exclude a
                source from the next scan; an excluded source never retires its earlier
                announcements.
              </p>
            </div>
          </div>

          {/* Moodle LMS Section */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Moodle LMS Integration
              </h3>
              <label className="flex cursor-pointer items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text)]">Enabled</span>
                <input
                  type="checkbox"
                  checked={config.moodleEnabled}
                  onChange={(e) => updateConfig({ moodleEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                />
              </label>
            </div>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="settings-moodle-url"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                >
                  {copy.onboarding.moodleUrlLabel}
                </label>
                <input
                  id="settings-moodle-url"
                  type="url"
                  value={moodleUrl}
                  onChange={(e) => setMoodleUrl(e.target.value)}
                  placeholder="https://moodle.university.edu"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="settings-moodle-ical"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                >
                  {copy.onboarding.moodleIcalLabel}
                </label>
                <input
                  id="settings-moodle-ical"
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
                  className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
                >
                  Save Moodle URLs
                </button>
              </div>
            </div>
          </div>

          {/* Notification Preferences Section */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {copy.settings.notificationPrefsTitle}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              {copy.settings.notificationPrefsNote}
            </p>
          </div>

          {/* External ICS Feeds Section */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {copy.settings.feedsTitle}
            </h3>

            <form onSubmit={handleAddFeed} className="mb-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                required
                aria-label="Feed name"
                value={newFeedName}
                onChange={(e) => setNewFeedName(e.target.value)}
                placeholder={copy.settings.feedNamePlaceholder}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none sm:w-1/3"
              />
              <input
                type="url"
                required
                aria-label="Feed HTTPS URL"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                placeholder={copy.settings.feedUrlPlaceholder}
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-[var(--accent-fill)] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--accent-fill-hover)]"
              >
                {copy.settings.addFeed}
              </button>
            </form>

            {feeds.length === 0 ? (
              <div className="text-xs italic text-[var(--text-muted)]">{copy.settings.noFeeds}</div>
            ) : (
              <div className="space-y-2">
                {feeds.map((feed) => (
                  <div
                    key={feed.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-[var(--text)]">
                        {feed.name}
                      </div>
                      <div className="truncate text-[11px] text-[var(--text-muted)]">
                        {feed.url}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={feed.enabled}
                        aria-label={`Enable feed ${feed.name}`}
                        onClick={() => upsertFeed({ ...feed, enabled: !feed.enabled })}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                          feed.enabled
                            ? "bg-[var(--accent-fill)]"
                            : "bg-slate-300 dark:bg-slate-700"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-2xs transition-transform ${
                            feed.enabled ? "translate-x-[18px]" : "translate-x-1"
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteFeed(feed.id)}
                        aria-label={`Delete feed ${feed.name}`}
                        className="rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-red-500/10 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Backup, Restore & Reset Section */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {copy.settings.backupHeader}
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => exportBackupFile()}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>{copy.settings.exportBackup}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isBrowserTier) {
                    backupFileInputRef.current?.click();
                  } else {
                    void importBackupFile();
                  }
                }}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)]"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>{copy.settings.importBackup}</span>
              </button>
              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json,application/json"
                aria-label={copy.settings.importBackup}
                className="hidden"
                onChange={handleBrowserImportBackup}
              />

              <button
                type="button"
                onClick={handleResetData}
                className="flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-500/10 dark:text-red-400"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
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
                <div className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">
                  {updateResult || `Current release: v${APP_VERSION}`}
                </div>
              </div>
              <button
                type="button"
                disabled={updateChecking}
                onClick={handleCheckUpdate}
                className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] disabled:opacity-50"
              >
                {updateChecking ? "Checking…" : copy.settings.checkUpdates}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
