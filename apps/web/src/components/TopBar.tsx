import React, { useEffect, useState } from "react";
import {
  Calendar as CalendarIcon,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Database,
  LayoutDashboard,
  Moon,
  PanelLeft,
  RefreshCw,
  Settings,
  Sun,
} from "lucide-react";
import { RadarMark } from "./BrandMarks";
import { SearchDropdown } from "./SearchDropdown";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import type { UpdateCheckResult, View } from "../state/types";

interface TopBarProps {
  onOpenSettings?: () => void;
  onOpenAuth?: () => void;
}

/**
 * The primary view switcher — v4 parity (v4-final:static/index.html
 * `#tab-btn-dashboard` / `#tab-btn-tasks` / `#tab-btn-calendar`).
 *
 * v4 put the switcher in the top bar and left the rail free for filters, so
 * v5 does the same: the rail's job is calendars, not navigation.
 */
const VIEW_SWITCHER: ReadonlyArray<{
  id: View;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "dashboard", label: copy.nav.dashboard, icon: LayoutDashboard },
  { id: "tasks", label: copy.nav.tasks, icon: CheckSquare },
  { id: "calendar", label: copy.nav.calendar, icon: CalendarIcon },
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const TopBar: React.FC<TopBarProps> = ({ onOpenSettings, onOpenAuth }) => {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const triggerSync = useAppStore((s) => s.triggerSync);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const auth = useAppStore((s) => s.data.auth);
  const config = useAppStore((s) => s.data.config);
  const openModal = useAppStore((s) => s.openModal);
  const googleLogin = useAppStore((s) => s.googleLogin);
  const checkUpdate = useAppStore((s) => s.checkUpdate);
  const installUpdate = useAppStore((s) => s.installUpdate);
  const addToast = useAppStore((s) => s.addToast);
  const currentView = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const currentWeekStart = useAppStore((s) => s.currentWeekStart);
  const shiftWeek = useAppStore((s) => s.shiftWeek);
  const jumpToToday = useAppStore((s) => s.jumpToToday);

  const [updateAvailable, setUpdateAvailable] = useState<UpdateCheckResult | null>(null);
  const [showUpdatePopover, setShowUpdatePopover] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateProgressLabel, setUpdateProgressLabel] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);

  const avatarUrl = auth.picture || config.userPicture || "";
  useEffect(() => {
    setAvatarError(false);
  }, [avatarUrl]);

  /**
   * Download the pending update and hand over to the installer. The progress
   * label comes from the desktop's byte counter: a percentage when the
   * server announced a total, plain megabytes when it did not (never a
   * made-up percentage).
   */
  async function handleInstallUpdate() {
    if (updateInstalling) return;
    setUpdateInstalling(true);
    setUpdateProgressLabel(null);
    setShowUpdatePopover(false);
    let unlisten: (() => void) | null = null;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<[number, number | null]>("update-progress", (event) => {
        const [received, total] = event.payload;
        setUpdateProgressLabel(
          total && total > 0
            ? `${Math.min(100, Math.round((received / total) * 100))}%`
            : `${(received / (1024 * 1024)).toFixed(1)} MB`,
        );
      });
      await installUpdate();
      addToast({ message: copy.topBar.updateInstalled, type: "info", duration: 6000 });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      addToast({ message: copy.topBar.updateFailed(reason), type: "error", duration: 8000 });
    } finally {
      if (unlisten) unlisten();
      setUpdateInstalling(false);
      setUpdateProgressLabel(null);
    }
  }

  // Check for updates on mount and every hour
  useEffect(() => {
    let cancelled = false;
    async function pollUpdate() {
      try {
        const res = await checkUpdate();
        if (!cancelled && res?.available) {
          const skipped = localStorage.getItem("quizradar_skip_version");
          if (skipped !== res.latestVersion) {
            setUpdateAvailable(res);
          }
        }
      } catch {
        // ignore update check failures
      }
    }
    pollUpdate();
    const hourlyTimer = setInterval(pollUpdate, 3600_000);
    return () => {
      cancelled = true;
      clearInterval(hourlyTimer);
    };
  }, [checkUpdate]);

  const syncLabel = {
    idle: copy.topBar.syncIdle,
    syncing: copy.topBar.syncScanning,
    success: copy.topBar.syncSynced,
    error: copy.topBar.syncFailed,
  }[syncStatus];

  const displayName =
    auth.name || config.userName || auth.email || config.userEmail || copy.topBar.userSignIn;

  const handleSettingsClick = () => {
    if (onOpenSettings) {
      onOpenSettings();
    } else {
      openModal({ id: "settings", flush: true, size: "lg" });
    }
  };

  const handleUserClick = () => {
    if (onOpenAuth) {
      onOpenAuth();
      return;
    }
    // Signed out: the chip IS the sign-in button, so it signs in (it must not
    // dump the user on a settings page). Signed in: it opens the profile.
    if (auth.authenticated) {
      openModal({ id: "account-profile" });
      return;
    }
    void googleLogin();
  };

  const handleSyncClick = () => {
    // Not dismissible: the overlay is exited through its own Close (after
    // the scan ends) or Cancel (which aborts the scan). A stray Escape or
    // backdrop click must never leave a scan running behind a closed
    // overlay.
    openModal({ id: "scan-progress", dismissible: false });
    triggerSync();
  };

  // The month label the calendar controls carry (v4 `#top-month-year-label`).
  const [weekYear, weekMonth] = currentWeekStart.split("-").map(Number);

  return (
    <header
      data-testid="app-topbar"
      className="relative sticky top-0 z-30 flex h-16 w-full items-center justify-between gap-2 border-b border-[var(--surface-border)] bg-[var(--surface)] px-3 transition-colors sm:px-4"
    >
      {/*
       * Window-drag underlay: the drag region used to sit on the <header>
       * itself, which makes some drag-region implementations swallow
       * mousedown for the whole bar — the search input could never take
       * focus from a click. The underlay only covers the empty surface;
       * everything the user interacts with paints above it.
       */}
      <div data-tauri-drag-region className="absolute inset-0 -z-10" aria-hidden="true" />

      {/* Left cluster — brand, update pill, view switcher, calendar controls */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/*
         * Brand cluster. At lg+ the radar mark is the rail toggle: hover
         * crossfades it into a PanelLeft glyph and a click collapses/expands
         * the sidebar; the wordmark keeps v4's "return to dashboard" job.
         * Below lg the rail is hidden by CSS, so the mark stays an honest
         * plain brand-home button there.
         */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            data-testid="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={copy.topBar.sidebarToggleAria}
            aria-pressed={sidebarOpen}
            title={copy.topBar.sidebarToggleAria}
            className="group relative hidden h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition hover:bg-[var(--surface-hover)] active:scale-95 lg:flex"
          >
            <span className="absolute inset-0 flex items-center justify-center opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0">
              <RadarMark animated className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 drop-shadow-sm" />
            </span>
            <PanelLeft
              className="h-4 w-4 text-[var(--text-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            onClick={() => setView("dashboard")}
            aria-label={copy.brand.home}
            className="group flex shrink-0 cursor-pointer items-center gap-2 pr-1 sm:gap-2.5"
          >
            <span className="lg:hidden">
              <RadarMark
                animated
                className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 drop-shadow-sm transition-transform duration-200 group-hover:scale-105 group-active:scale-95"
              />
            </span>
            <span className="hidden text-base font-bold tracking-tight text-[var(--text)] sm:block sm:text-lg">
              {copy.brand.name}
            </span>
          </button>
        </div>

        {/* Auto-updater pill — v4 sits it next to the brand */}
        {updateAvailable && (
          <div className="relative hidden shrink-0 md:block">
            <button
              type="button"
              data-testid="update-pill-btn"
              onClick={() => setShowUpdatePopover((v) => !v)}
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 px-2.5 py-1 text-xs font-semibold text-white shadow-xs transition hover:from-blue-800 hover:to-indigo-900 active:scale-95"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              <span>
                {updateInstalling
                  ? updateProgressLabel
                    ? copy.topBar.updateProgress(updateProgressLabel)
                    : copy.topBar.updateInstalling
                  : copy.topBar.updateAvailable}
              </span>
            </button>

            {showUpdatePopover && (
              <div
                data-testid="update-popover"
                className="absolute left-0 top-full z-50 mt-2 w-80 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-xs shadow-2xl sm:w-96"
              >
                <div className="border-b border-[var(--border)] bg-[var(--page)] px-4 py-3">
                  <div className="font-bold text-[var(--text)]">
                    QuizRadar v{updateAvailable.latestVersion} Available
                  </div>
                  <div className="mt-1 max-h-24 overflow-y-auto text-[11px] text-[var(--text-muted)]">
                    {updateAvailable.body || copy.topBar.updateNotesFallback}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 px-4 py-3">
                  <button
                    type="button"
                    data-testid="skip-update-btn"
                    onClick={() => {
                      if (updateAvailable.latestVersion) {
                        try {
                          localStorage.setItem(
                            "quizradar_skip_version",
                            updateAvailable.latestVersion,
                          );
                        } catch {
                          // ignore
                        }
                      }
                      setUpdateAvailable(null);
                      setShowUpdatePopover(false);
                    }}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                  >
                    {copy.topBar.skipUpdate}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleInstallUpdate();
                    }}
                    disabled={updateInstalling}
                    className="rounded-lg bg-[var(--accent-fill)] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-[var(--accent-fill-hover)] disabled:opacity-60"
                  >
                    {copy.topBar.updateInstall}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* View switcher — v4 segmented control */}
        <div
          data-testid="topbar-view-switcher"
          role="tablist"
          aria-label={copy.topBar.viewSwitcherLabel}
          className="hidden shrink-0 items-center rounded-xl border border-[var(--surface-border)] bg-[var(--page)] p-1 md:flex"
        >
          {VIEW_SWITCHER.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setView(item.id)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
                  isActive
                    ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-2xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Calendar navigation — v4 shows it only in the week calendar */}
        {currentView === "calendar" && (
          <div
            data-testid="topbar-calendar-controls"
            className="hidden shrink-0 items-center gap-1.5 border-l border-[var(--surface-border)] pl-1.5 lg:flex"
          >
            <button
              type="button"
              onClick={jumpToToday}
              className="h-8 cursor-pointer rounded-lg border border-[var(--surface-border)] px-2.5 text-xs font-medium text-[var(--text)] transition hover:bg-[var(--surface-hover)] active:scale-95"
            >
              {copy.calendar.jumpToToday}
            </button>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => shiftWeek(-1)}
                aria-label={copy.calendar.prevWeek}
                title={copy.calendar.prevWeek}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)]"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => shiftWeek(1)}
                aria-label={copy.calendar.nextWeek}
                title={copy.calendar.nextWeek}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)]"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <h2 className="hidden whitespace-nowrap text-sm font-semibold text-[var(--text)] xl:block">
              {MONTH_NAMES[(weekMonth ?? 1) - 1] ?? ""} {weekYear}
            </h2>
          </div>
        )}
      </div>

      {/* Search Bar — real input with its results attached underneath
          (SearchDropdown), not a pop-out modal. min-w-0 on both wrappers lets
          it shrink below its placeholder's min-content width on narrow
          screens instead of pushing the action cluster off-canvas. */}
      <div className="flex min-w-0 flex-1 items-center justify-center px-1 sm:px-4">
        <SearchDropdown />
      </div>

      {/* Action Controls — v4 order: Sync, Data & Backup, theme, Settings, account */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {/* Sync Button — primary blue-tinted scan CTA with WCAG AA >= 5.8:1 text */}
        <button
          type="button"
          onClick={handleSyncClick}
          disabled={syncStatus === "syncing"}
          aria-label={syncLabel}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-blue-200/80 bg-[#e8f0fe] px-3 text-xs font-semibold text-[#1557b0] transition hover:bg-[#d2e3fc] active:scale-[0.98] disabled:opacity-60 dark:border-blue-800/60 dark:bg-blue-950/70 dark:text-blue-300 dark:hover:bg-blue-900/70"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${syncStatus === "syncing" ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">{syncLabel}</span>
        </button>

        {/* On-device engine & local backup — refined surface button with emerald accent icon */}
        <button
          type="button"
          onClick={() => openModal({ id: "cloud-sync" })}
          title={copy.topBar.dataBackupTitle}
          className="hidden h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-2.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] active:scale-[0.98] md:flex sm:px-3"
        >
          <Database
            className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span>{copy.topBar.dataBackup}</span>
        </button>

        {/* Theme Toggle — v4 choreographed Sun/Moon stage */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? copy.topBar.themeLight : copy.topBar.themeDark}
          title={theme === "dark" ? copy.topBar.themeLight : copy.topBar.themeDark}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--surface-border)] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] active:scale-95 dark:text-amber-300"
        >
          <span className="theme-toggle-stage" aria-hidden="true">
            <Moon className="theme-icon-moon" />
            <Sun className="theme-icon-sun" />
          </span>
        </button>

        {/* Settings Button — v4 cog with the hover rotation */}
        <button
          type="button"
          onClick={handleSettingsClick}
          aria-label={copy.topBar.settingsAria}
          className="group hidden h-9 items-center gap-1.5 rounded-lg border border-[var(--surface-border)] px-2.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] active:scale-95 sm:flex sm:px-3"
        >
          <span className="settings-btn-stage">
            <Settings
              className="h-4 w-4 text-[var(--text-muted)] transition-colors group-hover:text-[var(--text)]"
              aria-hidden="true"
            />
          </span>
          <span className="hidden md:inline">{copy.topBar.settings}</span>
        </button>

        {/* User Chip — v4 account pill with graceful avatar fallback */}
        <button
          type="button"
          onClick={handleUserClick}
          aria-label={auth.authenticated ? `Account: ${displayName}` : copy.topBar.userSignIn}
          className="flex h-9 items-center gap-2 rounded-lg border border-[var(--surface-border)] px-1.5 pr-2.5 transition hover:bg-[var(--surface-hover)] active:scale-95 sm:pr-2.5"
        >
          {avatarUrl && !avatarError ? (
            <img
              src={avatarUrl}
              alt=""
              onError={() => setAvatarError(true)}
              className="h-6 w-6 rounded-md object-cover"
              aria-hidden="true"
            />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-fill)] text-xs font-semibold text-white">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="hidden max-w-[120px] truncate text-xs font-medium text-[var(--text)] md:inline">
            {displayName}
          </span>
        </button>
      </div>
    </header>
  );
};
