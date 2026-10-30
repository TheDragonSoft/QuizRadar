import { useEffect, useState } from "react";
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
  KeyRound,
  ChevronRight,
  ExternalLink,
  X,
} from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import { isTauriEnvironment, rpc } from "../state/rpc";
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
  const microsoftGrantScanningAccess = useAppStore((s) => s.microsoftGrantScanningAccess);
  const microsoftLogout = useAppStore((s) => s.microsoftLogout);
  const validateGeminiKey = useAppStore((s) => s.validateGeminiKey);
  const aiQuota = useAppStore((s) => s.aiQuota);
  const refreshAiQuota = useAppStore((s) => s.refreshAiQuota);
  const checkUpdate = useAppStore((s) => s.checkUpdate);
  const exportBackupFile = useAppStore((s) => s.exportBackupFile);
  const importBackupFile = useAppStore((s) => s.importBackupFile);
  const resetDatabase = useAppStore((s) => s.resetDatabase);
  const openModal = useAppStore((s) => s.openModal);
  const openExternalUrl = useAppStore((s) => s.openExternalUrl);
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

  // Browser-tier OAuth client IDs (GIS / MS PKCE popup)
  const isBrowserTier = !isTauriEnvironment();
  const [googleClientId, setGoogleClientId] = useState(config.googleClientId || "");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [teamsClientId, setTeamsClientId] = useState(config.teamsClientId || "");
  const [oauthSaved, setOauthSaved] = useState(false);

  const handleSaveOauthIds = async () => {
    await updateConfig({
      googleClientId: googleClientId.trim(),
      teamsClientId: teamsClientId.trim(),
    });
    if (!isBrowserTier) {
      const secret = googleClientSecret.trim();
      // The client secret belongs in the OS keyring — never in the config DB,
      // the logs or the web bundle. An empty field clears the override and
      // falls back to the secret bundled with the app.
      if (secret) {
        await rpc("set_secret", { key: "google_client_secret", value: secret });
      } else {
        await rpc("delete_secret", { key: "google_client_secret" });
      }
    }
    setGoogleClientSecret("");
    setOauthSaved(true);
    setTimeout(() => setOauthSaved(false), 2500);
  };

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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* M3 bottom-sheet drag handle (compact screens) */}
      <div className="mx-auto my-3 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 dark:bg-slate-700 md:hidden" />

      {/* Header band — v4 `settings-modal` header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--page)] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
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
          <X className="h-5 w-5" />
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
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
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
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-sm font-bold text-white shadow-sm">
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
              <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
                <span>Manage Accounts</span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </div>
            </button>

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
                    : "Signs in with the bundled Google client (ID + secret, kept inside the app) over PKCE. You can override the client in Settings → Account below."}
              </p>
              {!isBrowserTier && !auth.authenticated && !config.googleClientId && (
                <p className="mt-2 rounded-lg border border-slate-300/60 bg-slate-500/10 px-3 py-2 text-[11px] font-semibold text-[var(--text)]">
                  Using the bundled Google client (project gmail-summary-511914).
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
                  <ShieldCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
                  <span>Grant mail & calendar access</span>
                </button>
              )}
            </div>

            {/* OAuth client IDs — tier-aware (desktop loopback PKCE / browser GIS) */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--page)] p-4">
              <div className="flex items-center gap-2 mb-3">
                <KeyRound className="h-4 w-4 text-[var(--accent)]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {isBrowserTier
                    ? copy.settings.browserSignInHeader
                    : copy.settings.desktopSignInHeader}
                </h3>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                {isBrowserTier ? copy.settings.browserSignInNote : copy.settings.desktopSignInNote}
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                    {isBrowserTier
                      ? copy.settings.googleClientIdLabel
                      : copy.settings.googleDesktopClientIdLabel}
                  </label>
                  <input
                    type="text"
                    value={googleClientId}
                    onChange={(e) => setGoogleClientId(e.target.value)}
                    placeholder={copy.settings.googleClientIdPlaceholder}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    spellCheck={false}
                  />
                  {!isBrowserTier ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                      {copy.settings.googleDesktopClientIdHint}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                      {copy.settings.googleBrowserClientIdHint}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      openExternalUrl("https://console.cloud.google.com/apis/credentials")
                    }
                    className="mt-1.5 inline-flex min-h-6 items-center gap-1 rounded px-1 py-0.5 text-[11px] font-semibold text-[var(--accent)] hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    <span>{copy.settings.openGoogleConsole}</span>
                  </button>
                </div>
                {!isBrowserTier && (
                  <div>
                    <label
                      htmlFor="google-client-secret"
                      className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
                    >
                      {copy.settings.googleDesktopClientSecretLabel}
                    </label>
                    <input
                      id="google-client-secret"
                      type="password"
                      value={googleClientSecret}
                      onChange={(e) => setGoogleClientSecret(e.target.value)}
                      placeholder="Bundled with the app"
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                      {copy.settings.googleDesktopClientSecretHint}
                    </p>
                  </div>
                )}
                <div>
                  <label
                    htmlFor="teams-client-id"
                    className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1"
                  >
                    {isBrowserTier
                      ? copy.settings.teamsClientIdLabel
                      : copy.settings.teamsDesktopClientIdLabel}
                  </label>
                  <input
                    id="teams-client-id"
                    type="text"
                    value={teamsClientId}
                    onChange={(e) => setTeamsClientId(e.target.value)}
                    placeholder={copy.settings.teamsClientIdPlaceholder}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    spellCheck={false}
                  />
                  {!isBrowserTier && (
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                      {copy.settings.teamsDesktopClientIdHint}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      openExternalUrl(
                        "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
                      )
                    }
                    className="mt-1.5 inline-flex min-h-6 items-center gap-1 rounded px-1 py-0.5 text-[11px] font-semibold text-[var(--accent)] hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    <span>{copy.settings.openAzureConsole}</span>
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {isBrowserTier
                      ? copy.settings.redirectUriLabel(`${window.location.origin}/`)
                      : copy.settings.desktopRedirectUriNote}
                  </span>
                  <button
                    type="button"
                    onClick={handleSaveOauthIds}
                    className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
                  >
                    {oauthSaved ? "Saved ✓" : "Save Client IDs"}
                  </button>
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

              {!isBrowserTier && (
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">{copy.ai.sharedKeyHint}</p>
              )}

              {geminiValidationResult && (
                <div
                  className={`mt-2 text-xs font-semibold ${
                    geminiValidationResult.valid
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {geminiValidationResult.valid
                    ? isBrowserTier
                      ? copy.ai.keyValidMemory
                      : copy.ai.keyValid
                    : geminiValidationResult.error || copy.ai.keyInvalid}
                </div>
              )}

              <div className="mt-3 flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
                <div className="flex items-center justify-between">
                  <span>{copy.ai.quotaText(aiQuota?.callsToday ?? null)}</span>
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
                  onClick={() => openModal({ id: "onboarding", flush: true, size: "lg" })}
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
                          {c.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[var(--text)] truncate">
                            {c.name}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">
                            {c.id}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
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
                    {updateResult || `Current release: v${APP_VERSION}`}
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
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span>Local Storage · Zero Server Logs</span>
          </div>
          <span className="hidden sm:inline">·</span>
          <button
            type="button"
            onClick={() => {
              onClose();
              useAppStore.getState().setView("help");
            }}
            className="min-h-6 cursor-pointer rounded px-1 py-0.5 font-medium text-[var(--accent)] hover:underline"
          >
            Tier Capabilities & Help →
          </button>
        </div>
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
