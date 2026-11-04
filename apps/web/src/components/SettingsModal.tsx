import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  X,
} from "lucide-react";
import { copy } from "../copy";
import { courseAccessibleChip } from "../lib/coursePalette";
import { useAppStore } from "../state/store";
import { isTauriEnvironment } from "../state/rpc";
import { APP_VERSION } from "../generated/version";
import { GoogleMark, MicrosoftMark } from "./BrandMarks";
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
  const TAB_VALUES: ReadonlyArray<Tab> = ["account", "courses", "integrations"];
  // A stale localStorage value (or a bogus prop) from an older build must
  // never blank the body (the sections gate on strict equality) — validate
  // both before trusting them, and guard the bare storage read.
  const storedTab =
    typeof window !== "undefined" ? (localStorage.getItem(SETTINGS_TAB_KEY) as Tab | null) : null;
  const requestedTab = props?.initialTab as Tab | undefined;
  const initialTab =
    (requestedTab && TAB_VALUES.includes(requestedTab) ? requestedTab : null) ||
    (storedTab && TAB_VALUES.includes(storedTab) ? storedTab : null) ||
    "account";

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  // The store replaces a re-opened settings instance without remounting
  // (ModalStack keys by id), so a props.initialTab change must sync here —
  // the failure paths open "settings, initialTab: account" and toast that
  // the Account tab is showing.
  useEffect(() => {
    const requested = props?.initialTab as Tab | undefined;
    if (requested && TAB_VALUES.includes(requested)) {
      setActiveTab(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TAB_VALUES is a module constant
  }, [props]);
  // Tab switches morph the panel's bounds through the View Transitions API
  // (one GPU interpolation between the two tab heights). Where the API is
  // missing — or reduced motion is on — the body falls back to a keyed
  // fade/rise and the height snaps.
  const supportsViewTransitions =
    typeof document !== "undefined" &&
    typeof (document as Document & { startViewTransition?: (update: () => void) => unknown })
      .startViewTransition === "function" &&
    typeof window !== "undefined" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const handleTabChange = (tab: Tab) => {
    if (supportsViewTransitions) {
      (
        document as Document & {
          startViewTransition: (update: () => void) => unknown;
        }
      ).startViewTransition(() => {
        flushSync(() => setActiveTab(tab));
      });
    } else {
      setActiveTab(tab);
    }
    try {
      localStorage.setItem(SETTINGS_TAB_KEY, tab);
    } catch {
      // ignore
    }
  };

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
  const backupFileInputRef = useRef<HTMLInputElement>(null);

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
                // (and close) when the wipe actually happened.
                const wiped = await resetDatabase();
                if (!wiped) return;
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* M3 bottom-sheet drag handle (compact screens) */}
      <div className="mx-auto my-3 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 dark:bg-slate-700 md:hidden" />

      {/* Header band — v4 `settings-modal` header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--page)] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
            <Sliders className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="settings-modal-title"
              className="text-base font-bold text-[var(--text)] sm:text-lg"
            >
              {copy.settings.title}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Manage your account connections, courses, integrations, and local storage.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.common.close}
          className="rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Tab bar — v4 underline tabs with icons */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] px-4 pt-2 sm:px-6"
      >
        {(
          [
            { id: "account", label: copy.settings.tabAccount, Icon: User },
            { id: "courses", label: copy.settings.tabCourses, Icon: BookOpen },
            { id: "integrations", label: copy.settings.tabIntegrations, Icon: Sliders },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => handleTabChange(id)}
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2 text-xs font-semibold transition ${
              activeTab === id
                ? "border-[var(--accent-ink)] text-[var(--accent-ink)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Body — re-keyed per tab so the fallback fade/rise replays; under
          View Transitions the panel itself morphs, so the body stays still. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 pb-12">
        <div
          key={activeTab}
          className={`space-y-5 ${supportsViewTransitions ? "" : "settings-tab-enter"}`}
        >
          {/* ================= ACCOUNT TAB ================= */}
          {activeTab === "account" && (
            <div className="space-y-5">
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

              {/* Academic rhythm preset — persisted (`01` §4.1). The
                  onboarding wizard asks for it; this row shows what was
                  actually saved (and lets it be changed) so the answer is
                  never a silently discarded click. */}
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
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles
                      className="h-4 w-4 text-purple-600 dark:text-purple-400"
                      aria-hidden="true"
                    />
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
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
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
                    className="rounded-xl bg-purple-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-purple-800 transition disabled:opacity-50"
                  >
                    {validatingKey ? "Validating…" : copy.ai.validateButton}
                  </button>
                </div>

                {!isBrowserTier && (
                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                    {copy.ai.sharedKeyHint}
                  </p>
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
            </div>
          )}

          {/* ================= COURSES TAB ================= */}
          {activeTab === "courses" && (
            <div className="space-y-6">
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
                  <p className="text-xs tabular-nums text-[var(--text-muted)] mt-0.5">
                    {courses.length} course{courses.length === 1 ? "" : "s"} enrolled
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openModal({ id: "onboarding", flush: true })}
                    className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
                  >
                    {copy.settings.reopenOnboarding}
                  </button>
                  <button
                    type="button"
                    onClick={() => openModal({ id: "add-course" })}
                    className="flex items-center gap-1.5 rounded-xl bg-[var(--accent-fill)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-fill-hover)] transition"
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm"
                            style={{ backgroundColor: chip.solidBg }}
                          >
                            {c.name.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[var(--text)] truncate">
                              {c.name}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)] truncate">
                              {c.id}
                            </div>
                            <div className="text-[11px] tabular-nums text-[var(--text-muted)] mt-0.5">
                              {courseSlots.length} weekly slot{courseSlots.length === 1 ? "" : "s"}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 ml-2 shrink-0">
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
            </div>
          )}

          {/* ================= INTEGRATIONS TAB ================= */}
          {activeTab === "integrations" && (
            <div className="space-y-6">
              {/* Google Calendar Section */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden="true" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      {copy.settings.integrationsHeader}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={runGcalSync}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
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
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                    />
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Pushes the fresh radar to Google Calendar after every scan that found something.
                    A scan that fetched nothing, or a Calendar scope refusal, is reported in the
                    scan notes — never silently skipped.
                  </p>
                </div>
              </div>

              {/* University Sources Section — spec `01` §4.9: each source is
                  a user control. Gmail follows the Google account itself; the
                  Teams and Classroom toggles exclude one source from scans
                  without disconnecting the account. */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
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
                    Gmail scans run whenever the Google account is connected. These toggles exclude
                    a source from the next scan; an excluded source never retires its earlier
                    announcements.
                  </p>
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
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="settings-moodle-url"
                      className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
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
                      className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
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
                      className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
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

                <form onSubmit={handleAddFeed} className="flex flex-col sm:flex-row gap-2 mb-4">
                  <input
                    type="text"
                    required
                    aria-label="Feed name"
                    value={newFeedName}
                    onChange={(e) => setNewFeedName(e.target.value)}
                    placeholder={copy.settings.feedNamePlaceholder}
                    className="sm:w-1/3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none"
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
                    className="rounded-xl bg-[var(--accent-fill)] px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--accent-fill-hover)] transition shrink-0"
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
                        className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-[var(--text)] truncate">
                            {feed.name}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {feed.url}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
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
                            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-600 transition"
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
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                  {copy.settings.backupHeader}
                </h3>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => exportBackupFile()}
                    className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
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
                    className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition"
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
                    className="flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-500/10 transition"
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
                    <div className="text-xs tabular-nums text-[var(--text-muted)] mt-0.5">
                      {updateResult || `Current release: v${APP_VERSION}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={updateChecking}
                    onClick={handleCheckUpdate}
                    className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--border)_30%,transparent)] transition disabled:opacity-50"
                  >
                    {updateChecking ? "Checking…" : copy.settings.checkUpdates}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-end border-t border-[var(--border)] px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
        >
          {copy.common.close}
        </button>
      </div>
    </div>
  );
}
