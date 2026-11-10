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
  ChevronDown,
  ArrowLeft,
} from "lucide-react";
import { copy } from "../copy";
import { courseAccessibleChip } from "../lib/coursePalette";
import { useAppStore } from "../state/store";
import { isTauriEnvironment } from "../state/rpc";
import type { ThemeMode } from "../state/types";
import { APP_VERSION } from "../generated/version";
import { GoogleMark, MicrosoftMark } from "../components/BrandMarks";
import {
  analytics,
  isAnalyticsConfigured,
  isAnalyticsOptedOut,
  setAnalyticsOptOut,
  useFeatureFlag,
} from "../lib/analytics";
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
  const setTheme = useAppStore((s) => s.setTheme);
  const auth = useAppStore((s) => s.data.auth);
  const config = useAppStore((s) => s.data.config);
  const courses = useAppStore((s) => s.data.schedule.courses);
  const slots = useAppStore((s) => s.data.schedule.slots);
  const feeds = useAppStore((s) => s.data.config.feeds || []);

  const isVisionEnabled = useFeatureFlag("enable-ai-timetable-vision", true);

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
  const setView = useAppStore((s) => s.setView);
  const pendingSettingsSection = useAppStore((s) => s.pendingSettingsSection);
  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const [telemetryOptedOut, setTelemetryOptedOut] = useState(isAnalyticsOptedOut());
  const hasAnalyticsKey = isAnalyticsConfigured();

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
      analytics.backupAction("import");
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
  const [moodleAccordionOpen, setMoodleAccordionOpen] = useState(false);
  const [moodleAdvancedOpen, setMoodleAdvancedOpen] = useState(false);

  // Canvas & Blackboard state
  const canvasFeed = feeds.find(
    (f) => f.id === "feed-canvas-lms" || f.name.toLowerCase().includes("canvas"),
  );
  const blackboardFeed = feeds.find(
    (f) => f.id === "feed-blackboard-lms" || f.name.toLowerCase().includes("blackboard"),
  );
  const [canvasAccordionOpen, setCanvasAccordionOpen] = useState(false);
  const [canvasIcalUrl, setCanvasIcalUrl] = useState(() => canvasFeed?.url || "");
  const [blackboardAccordionOpen, setBlackboardAccordionOpen] = useState(false);
  const [blackboardIcalUrl, setBlackboardIcalUrl] = useState(() => blackboardFeed?.url || "");

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

  const handleSaveCanvas = async () => {
    const trimmed = canvasIcalUrl.trim();
    if (trimmed && !trimmed.startsWith("https://")) {
      addToast({
        type: "error",
        message: copy.settings.feedHttpsError,
      });
      return;
    }
    if (trimmed) {
      await upsertFeed({
        id: "feed-canvas-lms",
        name: "Canvas LMS Calendar",
        url: trimmed,
        enabled: true,
      });
      addToast({
        type: "success",
        message: "Canvas LMS calendar feed connected",
      });
    } else if (canvasFeed) {
      await deleteFeed(canvasFeed.id);
      addToast({
        type: "info",
        message: "Canvas LMS calendar feed removed",
      });
    }
  };

  const handleSaveBlackboard = async () => {
    const trimmed = blackboardIcalUrl.trim();
    if (trimmed && !trimmed.startsWith("https://")) {
      addToast({
        type: "error",
        message: copy.settings.feedHttpsError,
      });
      return;
    }
    if (trimmed) {
      await upsertFeed({
        id: "feed-blackboard-lms",
        name: "Blackboard Learn Calendar",
        url: trimmed,
        enabled: true,
      });
      addToast({
        type: "success",
        message: "Blackboard Learn calendar feed connected",
      });
    } else if (blackboardFeed) {
      await deleteFeed(blackboardFeed.id);
      addToast({
        type: "info",
        message: "Blackboard Learn calendar feed removed",
      });
    }
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
                analytics.backupAction("reset");
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
        <button
          type="button"
          onClick={() => setView("dashboard")}
          aria-label="Back to dashboard"
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-ink)] transition hover:bg-[var(--surface-hover)] cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>← Back</span>
        </button>
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
        <p className="mt-4 border-t border-[var(--border)] px-3 pt-3 text-xs leading-relaxed text-[var(--text-muted)]">
          {copy.settings.pageSubtitle}
        </p>
      </nav>

      {/* Scrollable page body */}
      <div className="min-w-0 flex-1 space-y-10 pb-16">
        {/* Breadcrumb navigation */}
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-xs text-[var(--text-muted)]"
        >
          <button
            type="button"
            onClick={() => setView("dashboard")}
            className="flex items-center gap-1.5 font-semibold text-[var(--accent-ink)] hover:underline cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Dashboard</span>
          </button>
          <span aria-hidden="true">/</span>
          <span className="font-semibold text-[var(--text)]">{copy.settings.title}</span>
        </nav>

        {/* Mobile header (the rail carries the title on lg+) */}
        <div className="lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setView("dashboard")}
              aria-label="Back to dashboard"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text)] transition hover:bg-[var(--surface-hover)] cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <h1 className="text-lg font-bold text-[var(--text)]">{copy.settings.title}</h1>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{copy.settings.pageSubtitle}</p>
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
                <div className="truncate text-xs text-[var(--text-muted)]">
                  {auth.email || config.userEmail || copy.settings.notSignedIn}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--accent-ink)]">
              <span>Manage Accounts</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </div>
          </button>

          {/* Appearance & Themes Suite */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4 space-y-4">
            <div>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Appearance &amp; Observatory Themes
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Configure your active appearance mode and select your preferred Light and Dark
                themes for daytime and nighttime studying.
              </p>
            </div>

            {/* Appearance Mode Segmented Control */}
            <div>
              <div className="mb-2 text-xs font-semibold text-[var(--text)]">
                Active Appearance Mode
              </div>
              <div className="flex gap-2">
                {[
                  {
                    id: "system",
                    label: "System",
                    icon: "🖥️",
                    active: false,
                    onClick: () => {
                      const isDark =
                        typeof window !== "undefined" &&
                        window.matchMedia &&
                        window.matchMedia("(prefers-color-scheme: dark)").matches;
                      setTheme(isDark ? "obsidian" : "solar");
                    },
                  },
                  {
                    id: "light",
                    label: "Light Mode",
                    icon: "☀️",
                    active: theme === "light" || theme === "solar",
                    onClick: () => setTheme("solar"),
                  },
                  {
                    id: "dark",
                    label: "Dark Mode",
                    icon: "🌙",
                    active: theme === "dark" || theme === "obsidian" || theme.startsWith("amoled"),
                    onClick: () => setTheme("obsidian"),
                  },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={mode.onClick}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      mode.active
                        ? "border-[var(--accent)] bg-[var(--surface)] text-[var(--accent-ink)] shadow-xs ring-1 ring-[var(--accent)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <span>{mode.icon}</span>
                    <span>{mode.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Light Theme Collection (Extensible for future light themes) */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text)]">
                  Preferred Light Theme
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">Active during daytime</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {[
                  {
                    id: "solar",
                    name: "Solar Dawn",
                    bg: "#F5F7FB",
                    accent: "#1A73E8",
                    desc: "Atmospheric dawn light with elevated frosted cards and a 3-tier radiant sun",
                    tag: "Default Light",
                  },
                ].map((t) => {
                  const isSelected = theme === "solar" || theme === "light";
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTheme("solar")}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition cursor-pointer ${
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--surface)] shadow-xs ring-1 ring-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <div
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-300/40 shadow-xs"
                        style={{ backgroundColor: t.bg }}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: t.accent }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[var(--text)]">{t.name}</span>
                          <span className="rounded bg-[var(--page)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--accent-ink)] border border-[var(--border)]">
                            {isSelected ? "Active" : t.tag}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{t.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dark Theme Collection (Extensible for future dark themes) */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text)]">
                  Preferred Dark Theme
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  Active during nighttime
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {[
                  {
                    id: "obsidian",
                    name: "Obsidian Cosmic",
                    bg: "#070A12",
                    accent: "#3B82F6",
                    desc: "Deep space obsidian with shimmering constellation starfield & diffraction blooms",
                    tag: "Default Dark",
                  },
                  {
                    id: "amoled-minimal",
                    name: "AMOLED Pure Starlight",
                    bg: "#000000",
                    accent: "#3B82F6",
                    desc: "Pitch black (#000000) OLED canvas with subtle, clean micro-starlight pinpricks across the whole UI",
                    tag: "AMOLED v1",
                  },
                  {
                    id: "amoled-sparkle",
                    name: "AMOLED Constellation Sparkles",
                    bg: "#000000",
                    accent: "#60A5FA",
                    desc: "Pure OLED black with prominent scattered 4-point sparkle cross stars and celestial clusters",
                    tag: "AMOLED v2",
                  },
                  {
                    id: "amoled-nebula",
                    name: "AMOLED Cosmic Stardust",
                    bg: "#000000",
                    accent: "#F59E0B",
                    desc: "Pure black canvas with scattered stellar dust and faint ethereal amber/violet nebula clouds",
                    tag: "AMOLED v3",
                  },
                ].map((t) => {
                  const isSelected =
                    theme === t.id ||
                    (t.id === "obsidian" && theme === "dark") ||
                    (t.id === "amoled-sparkle" && theme === "amoled");
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTheme(t.id as ThemeMode)}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition cursor-pointer ${
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--surface)] shadow-xs ring-1 ring-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <div
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/20 shadow-xs"
                        style={{ backgroundColor: t.bg }}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: t.accent }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[var(--text)]">{t.name}</span>
                          <span className="rounded bg-[var(--page)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--accent-ink)] border border-[var(--border)]">
                            {isSelected ? "Active" : t.tag}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{t.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {/* Academic rhythm preset — persisted (`01` §4.1) and now WIRED:
              it tunes the roadmap's prep-day spread (see the disclosure). */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <div className="text-xs font-bold text-[var(--text)]">
              {copy.onboarding.tracksTitle}
            </div>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">{savedTrackLabel}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {TRACK_OPTIONS.map((track) => {
                const active = config.academicTrack === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => void handleTrackChange(track.id)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${
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
            <p className="mt-2.5 text-xs text-[var(--text-muted)]">{copy.onboarding.trackEffect}</p>
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
                  <div className="text-xs text-[var(--text-muted)]">
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
            <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">
              {auth.authenticated
                ? `Connected${auth.email ? ` as ${auth.email}` : ""}. Tokens stay in the OS keyring (desktop) or in memory for one hour (web).`
                : isBrowserTier
                  ? copy.settings.browserSignInNote
                  : "Signs in with the bundled Google client (ID + secret, kept inside the app) over PKCE."}
            </p>
            {!isBrowserTier && !auth.authenticated && !config.googleClientId && (
              <p className="mt-2 rounded-lg border border-slate-300/60 bg-slate-500/10 px-3 py-2 text-xs font-semibold text-[var(--text)]">
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
                  <div className="text-xs text-[var(--text-muted)]">
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
            <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">
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
                <Sparkles className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
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
            <div className="space-y-1 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-hover)] p-3 text-xs text-[var(--text)]">
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
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                disabled={validatingKey || !geminiKeyInput.trim()}
                onClick={handleValidateGemini}
                className="rounded-xl bg-[var(--accent-fill)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--accent-fill-hover)] disabled:opacity-50"
              >
                {validatingKey ? "Validating…" : copy.ai.validateButton}
              </button>
            </div>

            {!isBrowserTier && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">{copy.ai.sharedKeyHint}</p>
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

            <div className="mt-3 flex flex-col gap-1 text-xs tabular-nums text-[var(--text-muted)]">
              <div className="flex items-center justify-between">
                <span>
                  {aiQuota?.sessionScope
                    ? copy.ai.quotaTextSession(aiQuota.callsToday ?? 0)
                    : copy.ai.quotaText(aiQuota?.callsToday ?? null)}
                </span>
                <span>{copy.ai.quotaCapNote}</span>
              </div>
              <div className="text-xs">{copy.ai.quotaLimitNote}</div>
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
          {isVisionEnabled ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--page)] p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-ink)]">
                  <Upload className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-bold text-[var(--text)]">
                    {copy.settings.timetableImportTitle}
                  </h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
                    {copy.settings.timetableImportSub}
                  </p>
                  {(!config.geminiEnabled || aiQuota?.keyInMemory === false) && (
                    <p className="mt-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
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
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-[var(--text)]">Courses & Timetable</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Add and manage courses manually.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openModal({ id: "add-course" })}
                className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[var(--accent-fill-hover)]"
              >
                {copy.settings.timetableImportManual}
              </button>
            </div>
          )}

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
                        <div className="truncate text-xs text-[var(--text-muted)]">{c.id}</div>
                        <div className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">
                          {courseSlots.length} weekly slot
                          {courseSlots.length === 1 ? "" : "s"} · {c.credits ?? 3.0} credits
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
              <p className="text-xs text-[var(--text-muted)]">
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
              <label
                htmlFor="settings-teams-toggle"
                className="flex cursor-pointer items-center justify-between"
              >
                <span className="text-xs font-semibold text-[var(--text)]">
                  Microsoft Teams
                  <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                    {config.teamsAccountName ? "connected" : "not connected"}
                  </span>
                </span>
                <input
                  id="settings-teams-toggle"
                  type="checkbox"
                  aria-label="Scan Microsoft Teams announcements"
                  checked={config.teamsEnabled}
                  onChange={(e) => updateConfig({ teamsEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                />
              </label>
              <label
                htmlFor="settings-classroom-toggle"
                className="flex cursor-pointer items-center justify-between"
              >
                <span className="text-xs font-semibold text-[var(--text)]">
                  Google Classroom
                  <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                    follows the Google account
                  </span>
                </span>
                <input
                  id="settings-classroom-toggle"
                  type="checkbox"
                  aria-label="Scan Google Classroom coursework"
                  checked={config.classroomEnabled}
                  onChange={(e) => updateConfig({ classroomEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                />
              </label>
              <p className="text-xs text-[var(--text-muted)]">
                Gmail scans run whenever the Google account is connected. These toggles exclude a
                source from the next scan; an excluded source never retires its earlier
                announcements.
              </p>
            </div>
          </div>

          {/* Moodle LMS Section */}
          <div
            data-testid="settings-moodle-card"
            className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4"
          >
            <button
              type="button"
              aria-label="Moodle LMS Calendar Feed"
              onClick={() => setMoodleAccordionOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {copy.settings.moodleTitle}
                </h3>
                {config.moodleEnabled && (moodleIcalUrl || moodleUrl) && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                    Connected
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)]">
                <span>{moodleAccordionOpen ? "Hide Guide" : "Setup Guide & Feed"}</span>
                {moodleAccordionOpen ? (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )}
              </div>
            </button>

            {moodleAccordionOpen && (
              <div className="mt-3.5 space-y-3.5 pt-3 border-t border-[var(--border)]">
                {/* Step-by-step instructions */}
                <div className="rounded-lg bg-[var(--surface)] p-3 text-xs text-[var(--text)] space-y-1.5 border border-[var(--border)]">
                  <div className="font-bold text-[var(--text)]">
                    {copy.settings.moodleGuideTitle}
                  </div>
                  <ol className="list-decimal pl-4 space-y-1 text-xs text-[var(--text-muted)]">
                    <li>{copy.settings.moodleGuideStep1}</li>
                    <li>{copy.settings.moodleGuideStep2}</li>
                    <li>{copy.settings.moodleGuideStep3}</li>
                    <li>{copy.settings.moodleGuideStep4}</li>
                    <li>{copy.settings.moodleGuideStep5}</li>
                  </ol>
                </div>

                {/* Primary: Moodle Personal iCal Feed URL */}
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <label
                      htmlFor="settings-moodle-ical"
                      className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                    >
                      {copy.settings.moodleIcalPrimaryLabel}
                    </label>
                    <span className="text-[10px] text-[var(--accent-ink)] font-semibold">Recommended</span>
                  </div>
                  <p className="mb-1.5 text-xs text-[var(--text-muted)]">
                    {copy.settings.moodleIcalPrimaryHelp}
                  </p>
                  <input
                    id="settings-moodle-ical"
                    type="url"
                    value={moodleIcalUrl}
                    onChange={(e) => setMoodleIcalUrl(e.target.value)}
                    placeholder="https://moodle.university.edu/calendar/export_execute.php?..."
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
                  />
                </div>

                {/* Demoted / Advanced: REST Web Service URL */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => setMoodleAdvancedOpen((v) => !v)}
                    className="flex w-full items-center justify-between text-left cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-[var(--text-muted)]">
                      {copy.settings.moodleAdvancedTitle}
                    </span>
                    <span className="text-[11px] text-[var(--accent-ink)] font-medium">
                      {moodleAdvancedOpen ? "Hide" : "Show"}
                    </span>
                  </button>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {copy.settings.moodleAdvancedHelp}
                  </p>
                  {moodleAdvancedOpen && (
                    <div className="pt-2">
                      <label
                        htmlFor="settings-moodle-url"
                        className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                      >
                        {copy.settings.moodleRestUrlLabel}
                      </label>
                      <input
                        id="settings-moodle-url"
                        type="url"
                        value={moodleUrl}
                        onChange={(e) => setMoodleUrl(e.target.value)}
                        placeholder={copy.settings.moodleRestPlaceholder}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--page)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
                      />
                    </div>
                  )}
                </div>

                {/* Actions & Enable Toggle */}
                <div className="flex items-center justify-between pt-1">
                  <label
                    htmlFor="settings-moodle-toggle"
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <input
                      id="settings-moodle-toggle"
                      type="checkbox"
                      aria-label="Enable Moodle LMS integration"
                      checked={config.moodleEnabled}
                      onChange={(e) => updateConfig({ moodleEnabled: e.target.checked })}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent-fill)]"
                    />
                    <span className="text-xs font-semibold text-[var(--text)]">Enable Moodle Sync</span>
                  </label>

                  <button
                    type="button"
                    onClick={handleSaveMoodle}
                    className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[var(--accent-fill-hover)] transition cursor-pointer"
                  >
                    {copy.settings.saveMoodle}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Canvas LMS Integration Accordion */}
          <div
            data-testid="settings-canvas-card"
            className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4"
          >
            <button
              type="button"
              aria-label="Canvas LMS Calendar Feed"
              onClick={() => setCanvasAccordionOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Canvas LMS Integration
                </h3>
                {canvasFeed?.enabled && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                    Connected
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)]">
                <span>{canvasAccordionOpen ? "Hide Guide" : "Setup Guide & Feed"}</span>
                {canvasAccordionOpen ? (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )}
              </div>
            </button>

            {canvasAccordionOpen && (
              <div className="mt-3.5 space-y-3 pt-3 border-t border-[var(--border)]">
                {/* Step-by-step instructions */}
                <div className="rounded-lg bg-[var(--surface)] p-3 text-xs text-[var(--text)] space-y-1.5 border border-[var(--border)]">
                  <div className="font-bold text-[var(--text)]">
                    How to extract your private Canvas Calendar Feed:
                  </div>
                  <ol className="list-decimal pl-4 space-y-1 text-xs text-[var(--text-muted)]">
                    <li>Log into your university Canvas portal in a browser.</li>
                    <li>
                      Click <strong>Calendar</strong> in the left global navigation sidebar.
                    </li>
                    <li>
                      In the right sidebar or footer, click <strong>Calendar Feed</strong>.
                    </li>
                    <li>
                      Copy the private URL ending in{" "}
                      <code className="text-[var(--accent-ink)] font-mono">.ics</code> and paste it
                      below:
                    </li>
                  </ol>
                </div>

                <div>
                  <label
                    htmlFor="settings-canvas-ical"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                  >
                    Canvas Private iCal Feed URL
                  </label>
                  <input
                    id="settings-canvas-ical"
                    type="url"
                    value={canvasIcalUrl}
                    onChange={(e) => setCanvasIcalUrl(e.target.value)}
                    placeholder="https://canvas.institution.edu/feeds/calendars/user_...ics"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleSaveCanvas}
                    className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[var(--accent-fill-hover)] transition cursor-pointer"
                  >
                    {canvasFeed ? "Update Canvas Feed" : "Connect Canvas Feed"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Blackboard Learn Integration Accordion */}
          <div
            data-testid="settings-blackboard-card"
            className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4"
          >
            <button
              type="button"
              aria-label="Blackboard Learn Calendar Feed"
              onClick={() => setBlackboardAccordionOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Blackboard Learn Integration
                </h3>
                {blackboardFeed?.enabled && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                    Connected
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)]">
                <span>{blackboardAccordionOpen ? "Hide Guide" : "Setup Guide & Feed"}</span>
                {blackboardAccordionOpen ? (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )}
              </div>
            </button>

            {blackboardAccordionOpen && (
              <div className="mt-3.5 space-y-3 pt-3 border-t border-[var(--border)]">
                {/* Step-by-step instructions */}
                <div className="rounded-lg bg-[var(--surface)] p-3 text-xs text-[var(--text)] space-y-1.5 border border-[var(--border)]">
                  <div className="font-bold text-[var(--text)]">
                    How to extract your Blackboard Calendar Link:
                  </div>
                  <ol className="list-decimal pl-4 space-y-1 text-xs text-[var(--text-muted)]">
                    <li>Log into your university Blackboard Learn portal.</li>
                    <li>
                      Navigate to the <strong>Calendar</strong> tool from the base navigation or
                      course list.
                    </li>
                    <li>
                      At the bottom or under the gear icon, click <strong>Share Calendar</strong> or{" "}
                      <strong>External Calendar Link</strong>.
                    </li>
                    <li>
                      Copy the generated{" "}
                      <code className="text-[var(--accent-ink)] font-mono">.ics</code> webcal or
                      https link and paste it below:
                    </li>
                  </ol>
                </div>

                <div>
                  <label
                    htmlFor="settings-blackboard-ical"
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                  >
                    Blackboard Calendar Feed URL
                  </label>
                  <input
                    id="settings-blackboard-ical"
                    type="url"
                    value={blackboardIcalUrl}
                    onChange={(e) => setBlackboardIcalUrl(e.target.value)}
                    placeholder="https://blackboard.institution.edu/webapps/calendar/export/..."
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleSaveBlackboard}
                    className="rounded-xl bg-[var(--accent-fill)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[var(--accent-fill-hover)] transition cursor-pointer"
                  >
                    {blackboardFeed ? "Update Blackboard Feed" : "Connect Blackboard Feed"}
                  </button>
                </div>
              </div>
            )}
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
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none sm:w-1/3"
              />
              <input
                type="url"
                required
                aria-label="Feed HTTPS URL"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                placeholder={copy.settings.feedUrlPlaceholder}
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
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
                      <div className="truncate text-xs text-[var(--text-muted)]">{feed.url}</div>
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
                onClick={() => {
                  exportBackupFile();
                  analytics.backupAction("export");
                }}
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
                    analytics.backupAction("import");
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

          {/* Usage Analytics & Privacy Section */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Anonymous Analytics & Health
                  </h3>
                  {hasAnalyticsKey && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                      PostHog Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  Help improve QuizRadar by sharing anonymous scan reliability and feature usage. We
                  strictly NEVER collect student grades, course titles, email contents, or schedule
                  details.
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center shrink-0">
                <input
                  type="checkbox"
                  checked={!telemetryOptedOut}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setTelemetryOptedOut(!enabled);
                    setAnalyticsOptOut(!enabled);
                    addToast({
                      type: "info",
                      message: enabled
                        ? "Anonymous analytics enabled"
                        : "Analytics disabled (opted out)",
                    });
                  }}
                  className="peer sr-only"
                  aria-label="Toggle anonymous usage analytics"
                />
                <div className="peer h-5 w-9 rounded-full bg-[var(--border)] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full peer-focus:outline-hidden"></div>
              </label>
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

          {/* Advanced Settings (Folded Accordion at the bottom) */}
          <details className="group rounded-xl border border-[var(--border)] bg-[var(--page)] p-4 transition">
            <summary className="flex cursor-pointer items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text)]">
              <span>Advanced Settings &amp; Custom OAuth Overrides</span>
              <ChevronRight
                className="h-4 w-4 transition-transform group-open:rotate-90 text-[var(--text-muted)]"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-4 pt-3 border-t border-[var(--border)] space-y-3">
              <p className="text-xs text-[var(--text-muted)]">
                The app ships with working built-in Google OAuth credentials out-of-the-box. Only
                enter custom client IDs below if you wish to override the built-in configuration
                with your own Google Cloud Console or Microsoft Azure tenant app.
              </p>
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1">
                  Google Client ID (Optional Override)
                </label>
                <input
                  type="text"
                  placeholder="Leave empty to use built-in Google client"
                  value={config.googleClientId || ""}
                  onChange={(e) =>
                    updateConfig({ googleClientId: e.target.value.trim() || undefined })
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1">
                  Microsoft Azure Client ID (Optional Override)
                </label>
                <input
                  type="text"
                  placeholder="Leave empty to use built-in Microsoft client"
                  value={config.teamsClientId || ""}
                  onChange={(e) =>
                    updateConfig({ teamsClientId: e.target.value.trim() || undefined })
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
