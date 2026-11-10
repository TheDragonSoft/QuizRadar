import { useState } from "react";
import {
  User,
  LogOut,
  Sparkles,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { copy } from "../../copy";
import { useAppStore } from "../../state/store";
import { isTauriEnvironment } from "../../state/rpc";
import type { ThemeMode } from "../../state/types";
import { GoogleMark, MicrosoftMark } from "../../components/BrandMarks";
import { SECTION_ID } from "./constants";

export function SettingsAccountSection() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const auth = useAppStore((s) => s.data.auth);
  const config = useAppStore((s) => s.data.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const googleLogin = useAppStore((s) => s.googleLogin);
  const googleLogout = useAppStore((s) => s.googleLogout);
  const microsoftLogin = useAppStore((s) => s.microsoftLogin);
  const microsoftGrantScanningAccess = useAppStore((s) => s.microsoftGrantScanningAccess);
  const microsoftLogout = useAppStore((s) => s.microsoftLogout);
  const validateGeminiKey = useAppStore((s) => s.validateGeminiKey);
  const aiQuota = useAppStore((s) => s.aiQuota);
  const refreshAiQuota = useAppStore((s) => s.refreshAiQuota);
  const openModal = useAppStore((s) => s.openModal);
  const addToast = useAppStore((s) => s.addToast);

  const isBrowserTier = !isTauriEnvironment();

  // BYOK Gemini state
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [validatingKey, setValidatingKey] = useState(false);
  const [geminiValidationResult, setGeminiValidationResult] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);

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

  return (
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
  );
}
