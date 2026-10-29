import React, { useEffect, useState, useCallback } from "react";
import { Moon, RefreshCw, Search, Settings, Sun, Sparkles, Radar } from "lucide-react";
import { copy } from "../copy";
import { useAppStore } from "../state/store";
import type { UpdateCheckResult } from "../state/types";

interface TopBarProps {
  onOpenSettings?: () => void;
  onOpenSearch?: () => void;
  onOpenAuth?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onOpenSettings, onOpenSearch, onOpenAuth }) => {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const triggerSync = useAppStore((s) => s.triggerSync);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const auth = useAppStore((s) => s.data.auth);
  const config = useAppStore((s) => s.data.config);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const openModal = useAppStore((s) => s.openModal);
  const googleLogin = useAppStore((s) => s.googleLogin);
  const checkUpdate = useAppStore((s) => s.checkUpdate);

  const [updateAvailable, setUpdateAvailable] = useState<UpdateCheckResult | null>(null);
  const [showUpdatePopover, setShowUpdatePopover] = useState(false);

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

  const handleOpenSearchModal = useCallback(() => {
    if (onOpenSearch) {
      onOpenSearch();
    } else {
      openModal("search");
    }
  }, [onOpenSearch, openModal]);

  // Keyboard shortcut: '/' focuses global search or opens search palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target as HTMLElement).isContentEditable
        )
      ) {
        e.preventDefault();
        handleOpenSearchModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenSearchModal]);

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

  return (
    <header
      data-testid="app-topbar"
      className="sticky top-0 z-30 flex h-16 w-full items-center justify-between gap-2 border-b border-[var(--surface-border)] bg-[var(--surface)] px-3 transition-colors sm:px-4"
    >
      {/* Brand — v4 wordmark block */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-sm sm:h-9 sm:w-9">
          <Radar className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
        </div>
        <span className="hidden text-base font-bold tracking-tight text-[var(--text)] sm:block sm:text-lg">
          QuizRadar
        </span>
      </div>

      {/* Search Bar — v4 floating search shell */}
      <div className="flex flex-1 items-center justify-center px-1 sm:px-4">
        <div
          role="button"
          tabIndex={0}
          onClick={handleOpenSearchModal}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleOpenSearchModal();
            }
          }}
          className="relative flex h-10 w-full max-w-xl cursor-pointer items-center rounded-2xl border border-[var(--surface-border)] bg-[var(--page)] shadow-xs transition-colors hover:bg-[var(--surface-hover)] focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)] focus-within:ring-2 focus-within:ring-[var(--accent)]/15"
        >
          <Search
            className="pointer-events-none absolute left-3.5 h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <span className="w-full truncate py-2 pl-9 pr-16 text-[13px] font-medium text-[var(--text-muted)]">
            {searchQuery || copy.topBar.searchPlaceholder}
          </span>
          <kbd
            className="pointer-events-none absolute right-2.5 flex select-none items-center gap-0.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)] shadow-xs tabular-nums"
            aria-hidden="true"
          >
            {copy.topBar.searchShortcut}
          </kbd>
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {/* Update Pill if update is available */}
        {updateAvailable && (
          <div className="relative">
            <button
              type="button"
              data-testid="update-pill-btn"
              onClick={() => setShowUpdatePopover((v) => !v)}
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 px-2.5 py-1 text-xs font-semibold text-white shadow-xs transition hover:from-blue-700 hover:to-indigo-800"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{copy.topBar.updateAvailable}</span>
            </button>

            {showUpdatePopover && (
              <div
                data-testid="update-popover"
                className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-xs shadow-2xl"
              >
                <div className="border-b border-[var(--border)] bg-[var(--page)] px-4 py-3">
                  <div className="font-bold text-[var(--text)]">
                    QuizRadar v{updateAvailable.latestVersion} Available
                  </div>
                  <div className="mt-1 max-h-24 overflow-y-auto text-[11px] text-[var(--text-muted)]">
                    {updateAvailable.body || "A new update is ready to install."}
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
                    Skip this version
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUpdatePopover(false);
                      handleSettingsClick();
                    }}
                    className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-[var(--accent-hover)]"
                  >
                    Update on next launch
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sync Button — v4 blue-tinted scan button */}
        <button
          type="button"
          onClick={handleSyncClick}
          disabled={syncStatus === "syncing"}
          aria-label={syncLabel}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-blue-200/60 bg-[#e8f0fe] px-3 text-xs font-semibold text-[#1a73e8] transition hover:bg-[#d2e3fc] active:scale-[0.98] disabled:opacity-60 dark:border-blue-800/60 dark:bg-blue-950/70 dark:text-blue-400 dark:hover:bg-blue-900/70"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${syncStatus === "syncing" ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">{syncLabel}</span>
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

        {/* User Chip — v4 account pill */}
        <button
          type="button"
          onClick={handleUserClick}
          aria-label={auth.authenticated ? `Account: ${displayName}` : copy.topBar.userSignIn}
          className="flex h-9 items-center gap-2 rounded-lg border border-[var(--surface-border)] px-1.5 pr-2.5 transition hover:bg-[var(--surface-hover)] active:scale-95 sm:pr-2.5"
        >
          {auth.picture || config.userPicture ? (
            <img
              src={auth.picture || config.userPicture || ""}
              alt=""
              className="h-6 w-6 rounded-md object-cover"
              aria-hidden="true"
            />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent)] text-xs font-semibold text-white">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="hidden max-w-[120px] truncate text-xs font-medium text-[var(--text)] md:inline">
            {displayName}
          </span>
        </button>

        {/* Settings Button — v4 cog with the hover rotation */}
        <button
          type="button"
          onClick={handleSettingsClick}
          aria-label={copy.topBar.settingsAria}
          className="group flex h-9 items-center gap-1.5 rounded-lg border border-[var(--surface-border)] px-2.5 text-xs font-semibold text-[var(--text)] transition hover:bg-[var(--surface-hover)] active:scale-95 sm:px-3"
        >
          <span className="settings-btn-stage">
            <Settings
              className="h-4 w-4 text-[var(--text-muted)] transition-colors group-hover:text-[var(--text)]"
              aria-hidden="true"
            />
          </span>
          <span className="hidden md:inline">{copy.topBar.settings}</span>
        </button>
      </div>
    </header>
  );
};
